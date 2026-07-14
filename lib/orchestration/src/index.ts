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

export interface RoomContext {
  /** Room / bay identifier, e.g. "RM-412". */
  roomId: string;
  /** Care unit, e.g. "4 West · Med-Surg". */
  unit: string;
  sensitivity: RoomSensitivity;
  /** The clinical workflow key the core evaluated (e.g. "clinical-session"). */
  workflowKey: string;
  /** Human label for the workflow, e.g. "Bedside care". */
  workflowLabel: string;
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

  const actions: DownstreamAction[] = CATALOG.map((spec) => {
    const id = `act-${room.roomId}-${spec.kind}`;
    const sensitive = spec.sensitive(room);
    let disposition: ActionDisposition;
    let reason: string;
    let requiresConfirmation = false;

    switch (outcome) {
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
            reason = "Confirmed by clinician";
          } else {
            disposition = "assist";
            requiresConfirmation = true;
            reason = "Prepared — requires clinician confirmation (sensitive)";
          }
        } else {
          disposition = "auto";
          reason = "Trusted — performed automatically";
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

  const mode = deriveMode(outcome, actions);
  return { mode, summary: summarize(mode, room), actions };
}

function deriveMode(outcome: DecisionOutcome, actions: DownstreamAction[]): OrchestrationMode {
  if (outcome === "deny") return "deny";
  if (outcome === "restrict") return "hold";
  if (outcome === "step_up") return "step_up";
  // allow
  return actions.some((a) => a.disposition === "assist") ? "assist" : "proceed";
}

function summarize(mode: OrchestrationMode, room: RoomContext): string {
  switch (mode) {
    case "proceed":
      return `Trusted presence — ${room.workflowLabel} prepared automatically in ${room.roomId}.`;
    case "assist":
      return `Environment prepared for ${room.workflowLabel} in ${room.roomId}; sensitive actions await clinician confirmation.`;
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
