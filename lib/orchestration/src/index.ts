// @workspace/orchestration — the "Trust + Orchestration = Action" layer.
//
// The decision core answers ALLOW / STEP-UP / RESTRICT / DENY. This layer turns
// that verdict, plus the room/workflow context, into a concrete PLAN of
// downstream actions across the physical hospital (door, session, device,
// lighting, clinical display, alerting) — each one classified by how it may be
// carried out:
//
//   auto     — safe to perform automatically (e.g. set room lighting)
//   assist   — prepared, but a human must confirm before it happens
//              (the "Assist" model: sensitive actions like unlocking a
//               controlled-med room or activating a PHI-bearing display)
//   step_up  — held until an identity step-up (badge tap / biometric) is satisfied
//   blocked  — not performed; the decision denied/limited it (with a reason)
//   applied  — an auto action, or an assist action a human has confirmed
//
// Design guarantees (clinical-safety first):
//   • Nothing sensitive is ever performed silently. Sensitive actions are ALWAYS
//     `assist` on an allow — they require explicit human confirmation.
//   • The layer is a PLANNER: it computes a plan, it does not itself actuate any
//     real system. Every action names its target system and its reason, for a
//     complete "what happened and why" audit record.
//   • Deterministic and pure — no Date.now / Math.random; same inputs → same plan.

import type { DecisionOutcome } from "@workspace/signalgrid-core";

export type ActionDisposition =
  | "auto"
  | "assist"
  | "step_up"
  | "blocked"
  | "applied";

/** How sensitive is the physical space the workflow is firing in. */
export type RoomSensitivity = "standard" | "elevated" | "controlled";

/**
 * Which vertical the space belongs to. It selects the downstream action
 * catalog and the human-confirmation language (a clinician confirms a bedside
 * PHI display; a supervisor confirms a controlled-area cage). Defaults to
 * `clinical` when omitted, so existing hospital callers are unaffected.
 */
export type FacilityDomain = "clinical" | "warehouse" | "global_fleet";

export interface RoomContext {
  /** Room / bay / zone identifier, e.g. "RM-412" or "CAGE-1". */
  roomId: string;
  /** Care unit or warehouse zone, e.g. "4 West · Med-Surg" or "DC-7 · High-value cage". */
  unit: string;
  sensitivity: RoomSensitivity;
  /** The workflow key the core evaluated (e.g. "clinical-session", "pick-pack"). */
  workflowKey: string;
  /** Human label for the workflow, e.g. "Bedside care" or "Controlled-area entry". */
  workflowLabel: string;
  /** Vertical this space belongs to. Defaults to `clinical` when omitted. */
  domain?: FacilityDomain;
}

export interface DownstreamAction {
  /** Deterministic id, stable for a given room + action kind. */
  id: string;
  kind: string;
  label: string;
  /** The system that would perform it (simulated), e.g. "Access control (PACS)". */
  targetSystem: string;
  /** Sensitive actions require human confirmation even on an allow. */
  sensitive: boolean;
  disposition: ActionDisposition;
  requiresConfirmation: boolean;
  reason: string;
}

/** The overall posture of the orchestration, derived from the actions. */
export type OrchestrationMode = "proceed" | "assist" | "step_up" | "hold" | "deny";

export interface OrchestrationPlan {
  mode: OrchestrationMode;
  summary: string;
  actions: DownstreamAction[];
}

export interface PlanInput {
  outcome: DecisionOutcome;
  /** Reason codes from the decision, surfaced onto blocked/held actions. */
  reasonCodes: string[];
  room: RoomContext;
  /** Ids of `assist` actions a human has confirmed this turn. */
  confirmedActionIds?: string[];
  /**
   * True once the holder has satisfied a step-up (badge tap / biometric). On a
   * `step_up` decision this releases the held actions — they behave as on an
   * allow (non-sensitive auto, sensitive still human-confirmed). Ignored for
   * other outcomes.
   */
  stepUpSatisfied?: boolean;
}

interface ActionSpec {
  kind: string;
  label: string;
  targetSystem: string;
  /** Is this action sensitive in the given room? */
  sensitive: (room: RoomContext) => boolean;
  /** Access actions are gated by step-up; environment actions are not. */
  gatedByStepUp: boolean;
}

// The downstream systems a trusted room-entry could coordinate. Ordered as they
// would naturally sequence on approach → enter → work → leave.
const CATALOG: ActionSpec[] = [
  {
    kind: "door.unlock",
    label: "Unlock room door",
    targetSystem: "Access control (PACS)",
    sensitive: (r) => r.sensitivity !== "standard",
    gatedByStepUp: true,
  },
  {
    kind: "workstation.session.start",
    label: "Start workstation session",
    targetSystem: "Workstation SSO",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "mobile.session.start",
    label: "Unlock mobile clinical session",
    targetSystem: "Mobile session broker",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "device.assign",
    label: "Assign shared device to holder",
    targetSystem: "Shared-device broker",
    sensitive: (r) => r.sensitivity === "controlled",
    gatedByStepUp: true,
  },
  {
    kind: "environment.lighting",
    label: "Set room lighting preset",
    targetSystem: "Room automation",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "clinical.display.activate",
    label: "Activate clinical display",
    targetSystem: "Clinical display (PHI)",
    sensitive: () => true, // PHI on screen — always human-confirmed
    gatedByStepUp: true,
  },
  {
    kind: "alert.route",
    label: "Route unit alerts to holder",
    targetSystem: "Nurse call / alerting",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "session.terminate.on_exit",
    label: "Arm session close on room exit",
    targetSystem: "Session lifecycle",
    sensitive: () => false,
    gatedByStepUp: false,
  },
];

// Additional coordination that only applies in a controlled-substance room —
// both are inherently sensitive (a physical cabinet, a second clinician), so
// they are always human-confirmed on an allow.
const CONTROLLED_EXTRAS: ActionSpec[] = [
  {
    kind: "medication.cabinet.unlock",
    label: "Unlock medication cabinet",
    targetSystem: "Automated dispensing cabinet",
    sensitive: () => true,
    gatedByStepUp: true,
  },
  {
    kind: "witness.require",
    label: "Request second-nurse witness",
    targetSystem: "Clinical witness workflow",
    sensitive: () => true,
    gatedByStepUp: true,
  },
];

// ── Warehouse catalog ────────────────────────────────────────────────────────
// The same structural shape as the clinical catalog (a gated access action, a
// non-sensitive session, an always-sensitive PII display, ambient prep, plus
// controlled-area extras), so every Assist-model safety invariant carries over.
const WAREHOUSE_CATALOG: ActionSpec[] = [
  {
    kind: "gate.unlock",
    label: "Unlock zone gate",
    targetSystem: "Access control (gate controller)",
    sensitive: (r) => r.sensitivity !== "standard",
    gatedByStepUp: true,
  },
  {
    kind: "handheld.session.start",
    label: "Start handheld scanner session",
    targetSystem: "Mobile session broker",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "task.assign",
    label: "Assign pick/pack task to holder",
    targetSystem: "Warehouse execution (WES/WMS)",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "device.assign",
    label: "Assign shared handheld to holder",
    targetSystem: "Shared-device broker",
    sensitive: (r) => r.sensitivity === "controlled",
    gatedByStepUp: true,
  },
  {
    kind: "environment.lighting",
    label: "Set zone / pick-to-light preset",
    targetSystem: "Facility automation",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "manifest.display.activate",
    label: "Activate order / manifest display",
    targetSystem: "Packing display (customer PII)",
    sensitive: () => true, // customer PII on the packing slip — always human-confirmed
    gatedByStepUp: true,
  },
  {
    kind: "alert.route",
    label: "Route zone exceptions to holder",
    targetSystem: "Warehouse alerting",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "session.terminate.on_exit",
    label: "Arm session close on zone exit",
    targetSystem: "Session lifecycle",
    sensitive: () => false,
    gatedByStepUp: false,
  },
];

// Controlled-area extras (high-value cage / hazmat) — both inherently sensitive
// (a physical cage, a second person), so always human-confirmed on an allow.
const WAREHOUSE_CONTROLLED_EXTRAS: ActionSpec[] = [
  {
    kind: "cage.unlock",
    label: "Unlock high-value / hazmat cage",
    targetSystem: "Automated cage / smart locker",
    sensitive: () => true,
    gatedByStepUp: true,
  },
  {
    kind: "witness.require",
    label: "Request supervisor witness",
    targetSystem: "Warehouse witness workflow",
    sensitive: () => true,
    gatedByStepUp: true,
  },
];

// ── Global-fleet catalog ─────────────────────────────────────────────────────
// Vehicle-mount + cross-region shape, structurally identical to the others (a
// gated access action, a non-sensitive session, an always-sensitive PII display,
// ambient prep, plus regulated-cargo extras), so the safety invariants hold.
const FLEET_CATALOG: ActionSpec[] = [
  {
    kind: "vehicle.unlock",
    label: "Unlock vehicle / cargo compartment",
    targetSystem: "Telematics access",
    sensitive: (r) => r.sensitivity !== "standard",
    gatedByStepUp: true,
  },
  {
    kind: "mount.session.start",
    label: "Start vehicle-mount session",
    targetSystem: "Mobile session broker",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "route.assign",
    label: "Assign route / manifest to holder",
    targetSystem: "Fleet dispatch (TMS)",
    sensitive: () => false,
    gatedByStepUp: true,
  },
  {
    kind: "device.assign",
    label: "Assign shared mount tablet to holder",
    targetSystem: "Shared-device broker",
    sensitive: (r) => r.sensitivity === "controlled",
    gatedByStepUp: true,
  },
  {
    kind: "environment.lighting",
    label: "Set cab / cargo lighting preset",
    targetSystem: "Vehicle automation",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "manifest.display.activate",
    label: "Activate manifest / cargo display",
    targetSystem: "Cargo display (customer + regulated-cargo PII)",
    sensitive: () => true, // regulated cargo + customer PII — always human-confirmed
    gatedByStepUp: true,
  },
  {
    kind: "alert.route",
    label: "Route fleet exceptions to holder",
    targetSystem: "Fleet alerting",
    sensitive: () => false,
    gatedByStepUp: false,
  },
  {
    kind: "session.terminate.on_exit",
    label: "Arm session close on vehicle egress",
    targetSystem: "Session lifecycle",
    sensitive: () => false,
    gatedByStepUp: false,
  },
];

// Cross-region / regulated-cargo extras — both inherently sensitive (a physical
// seal, a dispatcher co-sign), so always human-confirmed on an allow.
const FLEET_CONTROLLED_EXTRAS: ActionSpec[] = [
  {
    kind: "cargo.seal.release",
    label: "Release regulated-cargo seal",
    targetSystem: "Automated cargo seal",
    sensitive: () => true,
    gatedByStepUp: true,
  },
  {
    kind: "witness.require",
    label: "Request dispatcher co-sign",
    targetSystem: "Fleet witness workflow",
    sensitive: () => true,
    gatedByStepUp: true,
  },
];

const CATALOGS: Record<FacilityDomain, { catalog: ActionSpec[]; extras: ActionSpec[] }> = {
  clinical: { catalog: CATALOG, extras: CONTROLLED_EXTRAS },
  warehouse: { catalog: WAREHOUSE_CATALOG, extras: WAREHOUSE_CONTROLLED_EXTRAS },
  global_fleet: { catalog: FLEET_CATALOG, extras: FLEET_CONTROLLED_EXTRAS },
};

function applicableSpecs(room: RoomContext): ActionSpec[] {
  const { catalog, extras } = CATALOGS[room.domain ?? "clinical"];
  return room.sensitivity === "controlled" ? [...catalog, ...extras] : catalog;
}

const firstReason = (codes: string[], fallback: string): string =>
  codes.length > 0 ? codes[0] : fallback;

/**
 * Turn a decision + room context into an orchestration plan. Pure and
 * deterministic. Sensitive actions are never auto-applied on an allow — they
 * become `assist` and require confirmation (or `applied` if their id is in
 * `confirmedActionIds`).
 */
export function planOrchestration(input: PlanInput): OrchestrationPlan {
  const { outcome, reasonCodes, room } = input;
  const confirmed = new Set(input.confirmedActionIds ?? []);
  // Who confirms a sensitive action, phrased for the vertical.
  const confirmer =
    room.domain === "warehouse" ? "supervisor" : room.domain === "global_fleet" ? "dispatcher" : "clinician";

  // A satisfied step-up releases the held actions: from here they behave exactly
  // as on an allow (non-sensitive auto, sensitive still human-confirmed).
  const stepUpDone = outcome === "step_up" && input.stepUpSatisfied === true;
  const effective: DecisionOutcome = stepUpDone ? "allow" : outcome;

  const actions: DownstreamAction[] = applicableSpecs(room).map((spec) => {
    const id = `act-${room.roomId}-${spec.kind}`;
    const sensitive = spec.sensitive(room);
    let disposition: ActionDisposition;
    let reason: string;
    let requiresConfirmation = false;

    switch (effective) {
      case "deny":
        disposition = "blocked";
        reason = `Denied — ${firstReason(reasonCodes, "trust conditions not met")}`;
        break;
      case "restrict":
        // Limited: access + device actions are blocked; ambient prep still runs.
        if (spec.gatedByStepUp) {
          disposition = "blocked";
          reason = `Restricted — ${firstReason(reasonCodes, "elevated risk")}`;
        } else {
          disposition = "auto";
          reason = "Ambient preparation permitted under restriction";
        }
        break;
      case "step_up":
        if (spec.gatedByStepUp) {
          disposition = "step_up";
          requiresConfirmation = true;
          reason = `Held for step-up — ${firstReason(reasonCodes, "additional verification required")}`;
        } else {
          disposition = "auto";
          reason = "Ambient preparation permitted pending step-up";
        }
        break;
      case "allow":
      default:
        if (sensitive) {
          if (confirmed.has(id)) {
            disposition = "applied";
            reason = `Confirmed by ${confirmer}`;
          } else {
            disposition = "assist";
            requiresConfirmation = true;
            reason = `Prepared — requires ${confirmer} confirmation (sensitive)`;
          }
        } else {
          disposition = "auto";
          reason = stepUpDone ? "Released after step-up" : "Trusted — performed automatically";
        }
        break;
    }

    return {
      id,
      kind: spec.kind,
      label: spec.label,
      targetSystem: spec.targetSystem,
      sensitive,
      disposition,
      requiresConfirmation,
      reason,
    };
  });

  const mode = deriveMode(effective, actions);
  return { mode, summary: summarize(mode, room, stepUpDone, confirmer), actions };
}

function deriveMode(outcome: DecisionOutcome, actions: DownstreamAction[]): OrchestrationMode {
  if (outcome === "deny") return "deny";
  if (outcome === "restrict") return "hold";
  if (outcome === "step_up") return "step_up";
  // allow
  return actions.some((a) => a.disposition === "assist") ? "assist" : "proceed";
}

function summarize(mode: OrchestrationMode, room: RoomContext, stepUpDone = false, confirmer = "clinician"): string {
  const after = stepUpDone ? " after step-up" : "";
  switch (mode) {
    case "proceed":
      return `Trusted presence — ${room.workflowLabel} prepared automatically in ${room.roomId}${after}.`;
    case "assist":
      return `Environment prepared for ${room.workflowLabel} in ${room.roomId}${after}; sensitive actions await ${confirmer} confirmation.`;
    case "step_up":
      return `Access held in ${room.roomId} pending a step-up (badge tap / biometric).`;
    case "hold":
      return `Access limited in ${room.roomId}; only ambient preparation permitted.`;
    case "deny":
      return `Access denied in ${room.roomId}; nothing was actuated. Recorded with reason.`;
  }
}

/**
 * Simulate a clinician confirming one or more `assist` actions. Returns a new
 * plan with those actions moved to `applied`. Pure — recomputes from inputs.
 */
export function confirmActions(input: PlanInput, actionIds: string[]): OrchestrationPlan {
  const merged = new Set([...(input.confirmedActionIds ?? []), ...actionIds]);
  return planOrchestration({ ...input, confirmedActionIds: [...merged] });
}

/**
 * Simulate the holder satisfying a step-up (badge tap / biometric). On a
 * `step_up` decision this releases the held actions. Pure — recomputes.
 */
export function completeStepUp(input: PlanInput): OrchestrationPlan {
  return planOrchestration({ ...input, stepUpSatisfied: true });
}
