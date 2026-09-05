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

export type AppVertical = "healthcare" | "warehouse" | "industrial" | "global_fleet" | "retail" | "data_center" | "government";

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
  /** True once the holder has satisfied a step-up (badge tap / biometric).
   *  FULL release: every held action is released. Kept for the simulated/demo
   *  planners; the /v1 WebAuthn completion path uses the scoped form below. */
  stepUpSatisfied?: boolean;
  /** SCOPED release (review finding): keys of the specific actions a verified
   *  step-up gesture was bound to. Only these actions are released — every other
   *  gated/sensitive action stays held, so a gesture obtained for one pending
   *  action can never release the rest of the integration. If the listed keys
   *  cover EVERY held action, the plan is equivalent to a full release. */
  stepUpSatisfiedActionKeys?: string[];
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
  government: "authorizing officer",
};

/** Defensive at the untyped boundary, like the physical orchestration's twin: a
 *  `reasonCodes` that is not an array used to throw on the three RESTRICTIVE outcomes
 *  and survive on `allow` — the one verdict a malformed input should not favour. */
const firstReason = (codes: unknown, fallback: string): string => {
  const first = Array.isArray(codes) ? codes[0] : undefined;
  return typeof first === "string" && first.trim() !== "" ? first : fallback;
};

/** The human who confirms a sensitive action, by vertical — own-key guarded so a
 *  vertical the table does not know reads "an authorized confirmer", never "undefined
 *  confirmation" in the sentence a person reads before approving an irreversible act. */
const confirmerFor = (vertical: string): string =>
  Object.prototype.hasOwnProperty.call(DEFAULT_CONFIRMER, vertical)
    ? DEFAULT_CONFIRMER[vertical as AppVertical]
    : "an authorized confirmer";

/**
 * Turn a decision + an app integration into a plan of which of the app's actions
 * may run, each classified auto / assist / step-up / blocked. Pure and
 * deterministic. Mirrors the physical orchestration's Assist model so the safety
 * invariants are identical: sensitive actions are never auto on an allow.
 */
export function planAppSession(input: AppPlanInput): AppSessionPlan {
  const { integration, outcome, reasonCodes } = input;
  const confirmed = new Set(input.confirmedActionKeys ?? []);
  const confirmer = input.confirmer ?? confirmerFor(integration.vertical);

  // A release may be FULL (stepUpSatisfied — the simulated/demo path) or SCOPED to the
  // action keys a verified gesture was actually bound to. A scoped release that happens
  // to cover every held action is equivalent to a full one (so a single-gated-action
  // integration still leaves step_up mode); otherwise the plan honestly STAYS in
  // step_up mode with only the bound action released — a gesture for one action must
  // never release the rest of the integration (review finding).
  // Only keys the integration actually has can be released — a key it does not contain
  // releases nothing. And an integration with NO held actions has nothing a gesture
  // could satisfy, so it never reports a step-up as done: `[].every(...)` is vacuously
  // true, and until 2026-09-05 a bogus key on a read-only integration turned a live
  // step_up decision into `mode: "proceed"` with a summary asserting a step-up that
  // never happened — a ceremony that proves nothing, recorded as though it authorized.
  const knownKeys = new Set(integration.actions.map((a) => a.key));
  const releasedKeys = new Set((input.stepUpSatisfiedActionKeys ?? []).filter((k) => knownKeys.has(k)));
  const heldKeys = integration.actions.filter((a) => a.gatedByStepUp || a.sensitive).map((a) => a.key);
  const allHeldReleased = heldKeys.length > 0 && releasedKeys.size > 0 && heldKeys.every((k) => releasedKeys.has(k));
  const stepUpDone = outcome === "step_up" && (input.stepUpSatisfied === true || allHeldReleased);
  const effective: DecisionOutcome = stepUpDone ? "allow" : outcome;

  const actions: AppActionPlan[] = integration.actions.map((a) => {
    let disposition: AppActionDisposition;
    let reason: string;
    let requiresConfirmation = false;

    // This action's effective outcome: released individually iff the step-up gesture
    // was bound to it (or the release was full).
    const actionReleased = stepUpDone || (outcome === "step_up" && releasedKeys.has(a.key));
    const eff: DecisionOutcome = actionReleased ? "allow" : effective;

    switch (eff) {
      case "deny":
        disposition = "blocked";
        reason = `Denied — ${firstReason(reasonCodes, "trust conditions not met")}`;
        break;
      case "restrict":
        // A sensitive action is never "low-risk", so it is blocked under a
        // restriction regardless of the gatedByStepUp flag — the planner enforces
        // "nothing sensitive auto-fires" on its own inputs, not via the linter.
        if (a.gatedByStepUp || a.sensitive) {
          disposition = "blocked";
          reason = `Restricted — ${firstReason(reasonCodes, "elevated risk")}`;
        } else {
          disposition = "auto";
          reason = "Low-risk action permitted under restriction";
        }
        break;
      case "step_up":
        // Likewise hold a sensitive action for step-up even if it wasn't marked
        // gated — a sensitive action must never auto-fire under a step-up decision.
        if (a.gatedByStepUp || a.sensitive) {
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
          reason = actionReleased ? "Released after step-up" : "Trusted — performed automatically";
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
    default:
      // Fail closed on an unrecognized mode at the untyped runtime boundary.
      return `${integration.name}: denied; no action available (fail closed).`;
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

// Per-integration starter templates + the fail-closed validation lint.
export {
  APP_VERTICALS,
  lintAppIntegration,
  lintAppIntegrations,
  catalogLintsClean,
  starterTemplate,
  STARTER_TEMPLATES,
  type LintSeverity,
  type AppIntegrationIssue,
  type AppIntegrationLintResult,
} from "./templates";

export function listAppIntegrations(vertical?: AppVertical): AppIntegration[] {
  return APP_INTEGRATIONS.filter((i) => !vertical || i.vertical === vertical);
}

export function findAppIntegration(id: string): AppIntegration | undefined {
  return APP_INTEGRATIONS.find((i) => i.id === id);
}
