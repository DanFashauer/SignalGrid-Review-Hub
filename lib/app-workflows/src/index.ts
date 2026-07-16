// @workspace/app-workflows — gate APPLICATION workflows with the Assist model.
//
// The decision core answers ALLOW / STEP-UP / RESTRICT / DENY for an actor +
// device + workflow. The orchestration layer turns that into PHYSICAL actions
// (doors, gates, vehicles). THIS layer turns the same verdict into APPLICATION
// actions — the software people use all shift: open a chart, place a med order,
// broadcast a code alert, release a load, open a register. An app calls
// SignalGrid before it performs a sensitive action and gets back which of its
// actions may run automatically vs. which must be human-confirmed.
//
// Design guarantees (same as the physical layer):
//   • Nothing sensitive fires silently — sensitive actions are ALWAYS `assist`
//     on an allow (explicit human confirmation), or `applied` once confirmed.
//   • This is a PLANNER: it computes what an app MAY do; it performs nothing.
//   • Deterministic and pure — no Date.now / Math.random; public-safe fixtures.
//   • Generic app CATEGORIES only — never a real vendor/product name, never PHI.

import type { DecisionOutcome } from "@workspace/signalgrid-core";

export type AppVertical = "healthcare" | "warehouse" | "industrial" | "global_fleet" | "retail" | "data_center";

export type AppRiskTier = "standard" | "elevated" | "critical";

export type AppActionDisposition = "auto" | "assist" | "step_up" | "blocked" | "applied";

/** A single gated action an integrated app can perform. */
export interface AppAction {
  key: string;
  label: string;
  riskTier: AppRiskTier;
  /** Sensitive actions require human confirmation even on an allow. */
  sensitive: boolean;
  /**
   * Gated actions are the ones a `step_up` decision holds and a `restrict`
   * decision blocks (typically writes / high-assurance reads). Non-gated actions
   * are low-risk reads/acks that stay available under restriction.
   */
  gatedByStepUp: boolean;
}

/** An integrated application (a generic category, never a real product). */
export interface AppIntegration {
  id: string;
  /** Human label, e.g. "EMR / chart". */
  name: string;
  /** Short category descriptor, e.g. "Clinical record". */
  category: string;
  vertical: AppVertical;
  /** The workflow key the decision core should evaluate for this app's session. */
  workflowKey: string;
  actions: AppAction[];
}

export interface AppActionPlan {
  key: string;
  label: string;
  riskTier: AppRiskTier;
  sensitive: boolean;
  disposition: AppActionDisposition;
  requiresConfirmation: boolean;
  reason: string;
}

export type AppSessionMode = "proceed" | "assist" | "step_up" | "hold" | "deny";

export interface AppSessionPlan {
  integrationId: string;
  integrationName: string;
  outcome: DecisionOutcome;
  mode: AppSessionMode;
  summary: string;
  actions: AppActionPlan[];
}

export interface AppPlanInput {
  integration: AppIntegration;
  outcome: DecisionOutcome;
  reasonCodes: string[];
  /** Keys of `assist` actions a human has confirmed this turn. */
  confirmedActionKeys?: string[];
  /** True once the holder has satisfied a step-up (badge tap / biometric). */
  stepUpSatisfied?: boolean;
  /** Who confirms a sensitive action, phrased for the vertical. Defaults per vertical. */
  confirmer?: string;
}

const DEFAULT_CONFIRMER: Record<AppVertical, string> = {
  healthcare: "clinician",
  warehouse: "supervisor",
  industrial: "supervisor",
  global_fleet: "dispatcher",
  retail: "manager",
  data_center: "shift lead",
};

const firstReason = (codes: string[], fallback: string): string => (codes.length > 0 ? codes[0] : fallback);

/**
 * Turn a decision + an app integration into a plan of which of the app's actions
 * may run, each classified auto / assist / step-up / blocked. Pure and
 * deterministic. Mirrors the physical orchestration's Assist model so the safety
 * invariants are identical: sensitive actions are never auto on an allow.
 */
export function planAppSession(input: AppPlanInput): AppSessionPlan {
  const { integration, outcome, reasonCodes } = input;
  const confirmed = new Set(input.confirmedActionKeys ?? []);
  const confirmer = input.confirmer ?? DEFAULT_CONFIRMER[integration.vertical];

  const stepUpDone = outcome === "step_up" && input.stepUpSatisfied === true;
  const effective: DecisionOutcome = stepUpDone ? "allow" : outcome;

  const actions: AppActionPlan[] = integration.actions.map((a) => {
    let disposition: AppActionDisposition;
    let reason: string;
    let requiresConfirmation = false;

    switch (effective) {
      case "deny":
        disposition = "blocked";
        reason = `Denied — ${firstReason(reasonCodes, "trust conditions not met")}`;
        break;
      case "restrict":
        if (a.gatedByStepUp) {
          disposition = "blocked";
          reason = `Restricted — ${firstReason(reasonCodes, "elevated risk")}`;
        } else {
          disposition = "auto";
          reason = "Low-risk action permitted under restriction";
        }
        break;
      case "step_up":
        if (a.gatedByStepUp) {
          disposition = "step_up";
          requiresConfirmation = true;
          reason = `Held for step-up — ${firstReason(reasonCodes, "additional verification required")}`;
        } else {
          disposition = "auto";
          reason = "Low-risk action permitted pending step-up";
        }
        break;
      case "allow":
        if (a.sensitive) {
          if (confirmed.has(a.key)) {
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
      default:
        // Fail closed on any unrecognized runtime outcome (untyped JSON / unsafe
        // cast): never fall through to allow behaviour.
        disposition = "blocked";
        reason = "Denied — unrecognized decision outcome (fail closed)";
        break;
    }

    return {
      key: a.key,
      label: a.label,
      riskTier: a.riskTier,
      sensitive: a.sensitive,
      disposition,
      requiresConfirmation,
      reason,
    };
  });

  const mode = deriveMode(effective, actions);
  return {
    integrationId: integration.id,
    integrationName: integration.name,
    outcome,
    mode,
    summary: summarize(mode, integration, confirmer, stepUpDone),
    actions,
  };
}

function deriveMode(outcome: DecisionOutcome, actions: AppActionPlan[]): AppSessionMode {
  if (outcome === "deny") return "deny";
  if (outcome === "restrict") return "hold";
  if (outcome === "step_up") return "step_up";
  if (outcome === "allow") return actions.some((a) => a.disposition === "assist") ? "assist" : "proceed";
  return "deny"; // fail closed on an unrecognized outcome
}

function summarize(mode: AppSessionMode, integration: AppIntegration, confirmer: string, stepUpDone: boolean): string {
  const after = stepUpDone ? " after step-up" : "";
  switch (mode) {
    case "proceed":
      return `${integration.name}: trusted — all actions available${after}.`;
    case "assist":
      return `${integration.name}: available${after}; sensitive actions await ${confirmer} confirmation.`;
    case "step_up":
      return `${integration.name}: high-assurance actions held pending a step-up (badge tap / biometric).`;
    case "hold":
      return `${integration.name}: limited — only low-risk actions permitted under restriction.`;
    case "deny":
      return `${integration.name}: denied; no action available. Recorded with reason.`;
  }
}

/** Gate a SINGLE named action (for apps that check one action at a time). */
export function gateAppAction(input: AppPlanInput, actionKey: string): AppActionPlan | null {
  const plan = planAppSession(input);
  return plan.actions.find((a) => a.key === actionKey) ?? null;
}

/** Confirm one or more `assist` actions (a human approving a sensitive step). */
export function confirmAppActions(input: AppPlanInput, actionKeys: string[]): AppSessionPlan {
  const merged = new Set([...(input.confirmedActionKeys ?? []), ...actionKeys]);
  return planAppSession({ ...input, confirmedActionKeys: [...merged] });
}

/** Simulate the holder satisfying a step-up (badge tap / biometric). */
export function completeAppStepUp(input: AppPlanInput): AppSessionPlan {
  return planAppSession({ ...input, stepUpSatisfied: true });
}

// ── catalog ──────────────────────────────────────────────────────────────────

import { APP_INTEGRATIONS } from "./catalog";
export { APP_INTEGRATIONS } from "./catalog";

export function listAppIntegrations(vertical?: AppVertical): AppIntegration[] {
  return APP_INTEGRATIONS.filter((i) => !vertical || i.vertical === vertical);
}

export function findAppIntegration(id: string): AppIntegration | undefined {
  return APP_INTEGRATIONS.find((i) => i.id === id);
}
