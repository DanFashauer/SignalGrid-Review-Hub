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
  /** Demo tenant whose token evaluates this scenario. Defaults to Northwind (hospital). */
  tenant?: string;
}

/** Default tenant for a scenario that doesn't name one (the hospital seed). */
export const DEFAULT_TENANT = "tenant_northwind";

/** The tenant whose demo token should evaluate a given scenario. */
export function tenantForScenario(id: string): string {
  return findScenario(id)?.tenant ?? DEFAULT_TENANT;
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
export const CLINICAL_SCENARIOS: Scenario[] = [
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
    id: "offclock-medroom",
    title: "Off the clock · controlled med room",
    description: "Everything else is green — but the WFM says this badge's owner is scheduled and NOT clocked in. Off-the-clock work or someone else's badge; the labor plane steps the entry up.",
    identityRef: "nurse.offclock",
    deviceRef: "ipad-ward-07",
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

// Warehouse "Trusted Zone Entry" — a picker with a shared handheld approaching a
// pick aisle or a controlled high-value/hazmat cage. Same decision core + Assist
// model as the hospital, on the Atlas (warehouse) tenant seed. Public-safe.
export const WAREHOUSE_SCENARIOS: Scenario[] = [
  {
    id: "wh-compliant-pick",
    title: "Compliant picker · pick aisle",
    description: "On-shift picker, compliant shared handheld, pick/pack session in an open aisle.",
    identityRef: "picker.compliant",
    deviceRef: "handheld-01",
    tenant: "tenant_atlas",
    room: { roomId: "AISLE-12", unit: "DC-7 · Ambient pick", sensitivity: "standard", workflowKey: "pick-pack", workflowLabel: "Pick/pack session", domain: "warehouse" },
  },
  {
    id: "wh-compliant-cage",
    title: "Compliant picker · controlled cage",
    description: "On-shift picker entering a controlled high-value / hazmat cage (critical) — cage + manifest await supervisor confirmation.",
    identityRef: "picker.compliant",
    deviceRef: "handheld-01",
    tenant: "tenant_atlas",
    room: { roomId: "CAGE-1", unit: "DC-7 · High-value cage", sensitivity: "controlled", workflowKey: "controlled-area", workflowLabel: "Controlled-area entry", domain: "warehouse" },
  },
  {
    id: "wh-noncompliant-pick",
    title: "Non-compliant handheld · pick aisle",
    description: "Picker on a non-compliant shared handheld attempting a pick/pack session.",
    identityRef: "picker.noncompliant",
    deviceRef: "handheld-02",
    tenant: "tenant_atlas",
    room: { roomId: "AISLE-12", unit: "DC-7 · Ambient pick", sensitivity: "standard", workflowKey: "pick-pack", workflowLabel: "Pick/pack session", domain: "warehouse" },
  },
  {
    id: "wh-baseline-cage",
    title: "Security-baseline drift · controlled cage",
    description: "Handheld drifted from its hardening baseline; controlled-area entry requested — held for step-up.",
    identityRef: "picker.baseline_drift",
    deviceRef: "handheld-06",
    tenant: "tenant_atlas",
    room: { roomId: "CAGE-1", unit: "DC-7 · High-value cage", sensitivity: "controlled", workflowKey: "controlled-area", workflowLabel: "Controlled-area entry", domain: "warehouse" },
  },
  {
    id: "wh-disabled-pick",
    title: "Disabled account · pick aisle",
    description: "A disabled picker identity attempts entry — trust fails at the identity layer.",
    identityRef: "picker.disabled",
    deviceRef: "handheld-04",
    tenant: "tenant_atlas",
    room: { roomId: "AISLE-12", unit: "DC-7 · Ambient pick", sensitivity: "standard", workflowKey: "pick-pack", workflowLabel: "Pick/pack session", domain: "warehouse" },
  },
];

// Global-fleet "Trusted Vehicle Entry" — a driver with a shared vehicle-mount
// tablet starting a field session or a cross-region regulated-cargo checkout.
// Same decision core + Assist model, on the Meridian (global-fleet) tenant seed.
export const GLOBAL_FLEET_SCENARIOS: Scenario[] = [
  {
    id: "gf-compliant-field",
    title: "Compliant driver · field session",
    description: "On-shift driver, compliant shared vehicle-mount tablet, field session in-region.",
    identityRef: "driver.compliant",
    deviceRef: "vehicle-mount-01",
    tenant: "tenant_meridian",
    room: { roomId: "VEH-4471", unit: "EU-West · Regional", sensitivity: "standard", workflowKey: "field-session", workflowLabel: "Field session", domain: "global_fleet" },
  },
  {
    id: "gf-compliant-checkout",
    title: "Compliant driver · cross-region checkout",
    description: "On-shift driver starting a cross-region regulated-cargo checkout (critical) — seal + manifest await dispatcher confirmation.",
    identityRef: "driver.compliant",
    deviceRef: "vehicle-mount-01",
    tenant: "tenant_meridian",
    room: { roomId: "VEH-4471", unit: "EU-West → APAC · Long-haul", sensitivity: "controlled", workflowKey: "vehicle-checkout", workflowLabel: "Cross-region checkout", domain: "global_fleet" },
  },
  {
    id: "gf-noncompliant-field",
    title: "Non-compliant mount · field session",
    description: "Driver on a non-compliant shared vehicle-mount tablet attempting a field session.",
    identityRef: "driver.noncompliant",
    deviceRef: "vehicle-mount-02",
    tenant: "tenant_meridian",
    room: { roomId: "VEH-4472", unit: "EU-West · Regional", sensitivity: "standard", workflowKey: "field-session", workflowLabel: "Field session", domain: "global_fleet" },
  },
  {
    id: "gf-baseline-checkout",
    title: "Security-baseline drift · cross-region checkout",
    description: "Vehicle-mount tablet drifted from its hardening baseline; cross-region checkout requested — held for step-up.",
    identityRef: "driver.baseline_drift",
    deviceRef: "vehicle-mount-06",
    tenant: "tenant_meridian",
    room: { roomId: "VEH-4476", unit: "EU-West → APAC · Long-haul", sensitivity: "controlled", workflowKey: "vehicle-checkout", workflowLabel: "Cross-region checkout", domain: "global_fleet" },
  },
  {
    id: "gf-disabled-field",
    title: "Disabled account · field session",
    description: "A disabled driver identity attempts entry — trust fails at the identity layer.",
    identityRef: "driver.disabled",
    deviceRef: "vehicle-mount-04",
    tenant: "tenant_meridian",
    room: { roomId: "VEH-4474", unit: "EU-West · Regional", sensitivity: "standard", workflowKey: "field-session", workflowLabel: "Field session", domain: "global_fleet" },
  },
];

export const SCENARIOS: Scenario[] = [...CLINICAL_SCENARIOS, ...WAREHOUSE_SCENARIOS, ...GLOBAL_FLEET_SCENARIOS];

export interface ScenarioSummary {
  id: string;
  title: string;
  description: string;
  room: RoomContext;
  /** Vertical this scenario belongs to (grouping for the UI). */
  domain: NonNullable<RoomContext["domain"]>;
}

export function listScenarios(): ScenarioSummary[] {
  return SCENARIOS.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    room: s.room,
    domain: s.room.domain ?? "clinical",
  }));
}

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Run one scenario end to end: real decision → orchestration plan. Throws if the
 * scenario is unknown. `confirmedActionIds` promotes `assist` actions to
 * `applied` (a clinician confirming a sensitive step).
 */
export interface RoomEntryOptions {
  confirmedActionIds?: string[];
  /** True once the holder has satisfied a step-up (badge tap / biometric). */
  stepUpSatisfied?: boolean;
}

export function runRoomEntry(
  core: CoreLike,
  token: string,
  scenarioId: string,
  options: RoomEntryOptions = {},
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
    confirmedActionIds: options.confirmedActionIds ?? [],
    stepUpSatisfied: options.stepUpSatisfied ?? false,
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
