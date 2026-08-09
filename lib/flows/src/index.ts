// @workspace/flows — the admin-configurable flow layer.
//
// Administrators don't write logic; they REGISTER SIGNALS and CONFIGURE FLOWS.
// The Grid takes that config and does the rest: it decides each action's
// disposition from the live trust decision (the Assist model), and it watches
// the flow's own health. When a signal or a flow step breaks, the Grid either
// SELF-HEALS (if the flow is configured with an agent/bot) or GENERATES AN
// INCIDENT for whichever ITSM the business uses and pages the right team. It is
// fully customizable — that is the point — and it compounds: the more signals a
// flow consumes, the smarter and faster its decisions and its break-detection.
//
// Pure and deterministic — no Date.now / Math.random; a timestamp is passed in.
// Everything here is public-safe: the incident is an ITSM-AGNOSTIC descriptor
// (it names the target system, it does not call it) and self-heal is simulated.

// ── approval configuration (admin-authored) ─────────────────────────────────

/**
 * How an action is authorized. Admins pick this per action, per flow.
 * - `automated`             — cleared to run with no human approval (on an allow
 *   decision). NOT "the Grid performs it": this module plans dispositions and
 *   contains no executor. Who carries the action out is the host app and the
 *   systems of record — the same boundary the file header states for incidents
 *   and self-heal.
 * - `admin_approval`        — one administrator must approve.
 * - `dual_approval`         — two administrators must approve (four-eyes).
 * - `user_override_on_downtime` — the ONLY case an end user acts: a break-glass
 *   override, permitted only while a declared downtime is active, and only with
 *   its disaster-recovery safety nets satisfied. End users never approve
 *   anything else.
 */
export type ApprovalPolicy =
  | "automated"
  | "admin_approval"
  | "dual_approval"
  | "user_override_on_downtime";

export interface FlowAction {
  key: string;
  label: string;
  approval: ApprovalPolicy;
  /** Disaster-recovery safety nets that must hold before a user override runs. */
  safetyNets?: string[];
}

export type FlowSeverity = "sev1" | "sev2" | "sev3";

// ── governance (who owns the decision, who accepts the risk) ─────────────────
// A runtime decision layer grants access; governance decides who *should* have it.
// The technology is only half the problem — a workflow that acts on its own with
// nobody accountable is the classic IAM failure ("if nobody owns the decisions,
// the technology won't fix the problem"). These OPTIONAL fields make ownership and
// accountability first-class and lintable. `approval` on each action already
// captures "who approves"; these capture "who owns" and "who accepts the risk".
//
//   • owner       — the team/role that owns this workflow (the decision).
//   • accountable — the team/role that accepts the residual risk when it runs
//                   (especially for an automated, no-human-in-the-loop action).

/** How a broken flow is handled — self-heal via an agent, or raise an incident. */
export interface AutoHeal {
  /** The agent/bot that offloads the smart remediation (simulated). */
  agent: string;
  /** Whether the agent is expected to auto-resolve without paging a human. */
  autoResolves: boolean;
}

/** An admin-authored flow: the signals it needs, the actions it drives. */
export interface Flow {
  id: string;
  name: string;
  description: string;
  /** Signal ids this flow depends on. Missing/broken → the flow is degraded/broken. */
  requiredSignals: string[];
  actions: FlowAction[];
  /** The team paged when this flow breaks. */
  supportTeam: string;
  /** Which ITSM the business routes incidents to (agnostic label). */
  itsm: string;
  /** Severity to raise if this flow breaks. */
  severityOnBreak: FlowSeverity;
  /** If set, the flow self-heals via this agent before/instead of an incident. */
  autoHeal?: AutoHeal;
  /** Governance: the team/role that owns this workflow (the decision). */
  owner?: string;
  /** Governance: the team/role that accepts the residual risk when it runs. */
  accountable?: string;
}

// ── signal health (observed) ────────────────────────────────────────────────

export type SignalStatus = "healthy" | "stale" | "broken" | "missing";

/** Observed state of a signal the grid consumes. */
export interface SignalState {
  id: string;
  status: SignalStatus;
}

// ── flow health ─────────────────────────────────────────────────────────────

export type FlowStatus = "healthy" | "degraded" | "broken";

export interface FlowHealth {
  flowId: string;
  status: FlowStatus;
  /** Required signals that are missing or broken (these break the flow). */
  brokenSignals: string[];
  /** Required signals that are stale (these degrade the flow). */
  staleSignals: string[];
}

// Most-restrictive wins, so a signal observed both broken and healthy is treated
// as broken. Fail closed: ambiguous/conflicting input never resolves to healthy.
const SIGNAL_SEVERITY: Record<SignalStatus, number> = { broken: 3, missing: 2, stale: 1, healthy: 0 };

function statusOf(signalStates: SignalState[]): Map<string, SignalStatus> {
  const m = new Map<string, SignalStatus>();
  for (const s of signalStates) {
    const prev = m.get(s.id);
    if (prev === undefined || SIGNAL_SEVERITY[s.status] > SIGNAL_SEVERITY[prev]) m.set(s.id, s.status);
  }
  return m;
}

/**
 * Evaluate a flow's health against the observed signal states. A required signal
 * that is missing or broken breaks the flow; a stale one degrades it.
 */
export function evaluateFlowHealth(flow: Flow, signalStates: SignalState[]): FlowHealth {
  const states = statusOf(signalStates);
  const brokenSignals: string[] = [];
  const staleSignals: string[] = [];
  for (const sig of flow.requiredSignals) {
    const st = states.get(sig) ?? "missing";
    if (st === "missing" || st === "broken") brokenSignals.push(sig);
    else if (st === "stale") staleSignals.push(sig);
  }
  const status: FlowStatus = brokenSignals.length > 0 ? "broken" : staleSignals.length > 0 ? "degraded" : "healthy";
  return { flowId: flow.id, status, brokenSignals, staleSignals };
}

// ── break resolution: self-heal OR incident ─────────────────────────────────

/** An ITSM-agnostic incident descriptor (named, never actually dispatched). */
export interface IncidentDescriptor {
  flowId: string;
  severity: FlowSeverity;
  title: string;
  summary: string;
  brokenSignals: string[];
  supportTeam: string;
  itsm: string;
  createdAt: string;
}

/** A simulated self-heal plan produced by the flow's configured agent. */
export interface SelfHealPlan {
  flowId: string;
  agent: string;
  autoResolves: boolean;
  steps: string[];
  /** If the agent cannot fully resolve, an incident is still raised. */
  fallbackIncident: IncidentDescriptor | null;
}

export type BreakResolution =
  | { kind: "healthy" }
  | { kind: "self_heal"; plan: SelfHealPlan }
  | { kind: "incident"; incident: IncidentDescriptor };

function incidentFor(flow: Flow, health: FlowHealth, nowIso: string): IncidentDescriptor {
  return {
    flowId: flow.id,
    severity: flow.severityOnBreak,
    title: `${flow.name}: flow broken`,
    summary: `Required signal(s) ${health.brokenSignals.join(", ")} missing/broken; ${flow.name} cannot run trust-gated actions.`,
    brokenSignals: health.brokenSignals,
    supportTeam: flow.supportTeam,
    itsm: flow.itsm,
    createdAt: nowIso,
  };
}

/**
 * Decide what happens when a flow is evaluated: nothing if healthy; if broken,
 * self-heal via the configured agent (with an incident fallback when the agent
 * can't fully resolve) or, if no agent is configured, raise an incident for the
 * ITSM. A degraded (stale-only) flow raises a lower-noise incident is avoided —
 * it is reported as healthy-enough to run but surfaced in health.
 */
export function resolveFlowBreak(flow: Flow, signalStates: SignalState[], nowIso: string): BreakResolution {
  const health = evaluateFlowHealth(flow, signalStates);
  if (health.status !== "broken") return { kind: "healthy" };

  if (flow.autoHeal) {
    const incident = incidentFor(flow, health, nowIso);
    return {
      kind: "self_heal",
      plan: {
        flowId: flow.id,
        agent: flow.autoHeal.agent,
        autoResolves: flow.autoHeal.autoResolves,
        steps: [
          `Detect: ${health.brokenSignals.join(", ")} broken on ${flow.name}`,
          `Offload to ${flow.autoHeal.agent} for smart remediation (simulated)`,
          flow.autoHeal.autoResolves
            ? "Re-acquire the signal and restore the flow"
            : "Attempt remediation; escalate if unresolved",
        ],
        // A non-auto-resolving agent still raises an incident so a human is aware.
        fallbackIncident: flow.autoHeal.autoResolves ? null : incident,
      },
    };
  }
  return { kind: "incident", incident: incidentFor(flow, health, nowIso) };
}

// ── action dispositions (Assist model, admin-configured) ─────────────────────

export type ActionDisposition = "automated" | "admin_approval" | "dual_approval" | "user_override" | "held" | "blocked";

export interface ActionPlan {
  key: string;
  label: string;
  approval: ApprovalPolicy;
  disposition: ActionDisposition;
  requiresApprovals: number;
  reason: string;
}

export interface PlanActionsOptions {
  /** A declared downtime — the only condition under which a user override applies. */
  downtime?: boolean;
  /**
   * True once the action's configured disaster-recovery safety nets have been
   * verified satisfied. An override is NEVER offered without this (fail closed).
   */
  safetyNetsCleared?: boolean;
  /**
   * True once the holder has satisfied the step-up (real verification). Until
   * then a `step_up` outcome HOLDS every action — nothing runs before the
   * additional verification the core requires.
   */
  stepUpSatisfied?: boolean;
}

/**
 * Compute each action's disposition from the admin's config + the live decision.
 * Fail-closed throughout:
 *   - deny / restrict → blocked (except a valid break-glass override).
 *   - step_up (not yet satisfied) → every action HELD pending verification.
 *   - allow (or a satisfied step-up) → automated runs; admin/dual wait for
 *     approval(s).
 *   - a `user_override_on_downtime` action is offered to the end user ONLY when a
 *     downtime is declared AND the action has DR safety nets configured AND they
 *     are verified satisfied. Missing/empty/unsatisfied safety nets → blocked.
 */
export function planFlowActions(
  flow: Flow,
  outcome: "allow" | "step_up" | "restrict" | "deny",
  opts: PlanActionsOptions = {},
): ActionPlan[] {
  const downtime = opts.downtime === true;
  const safetyNetsCleared = opts.safetyNetsCleared === true;
  const stepUpSatisfied = opts.stepUpSatisfied === true;
  const stepUpHeld = outcome === "step_up" && !stepUpSatisfied;

  return flow.actions.map((a) => {
    let disposition: ActionDisposition;
    let requiresApprovals = 0;
    let reason: string;

    if (a.approval === "user_override_on_downtime") {
      // Break-glass: available only during a downtime, and only with configured
      // DR safety nets that are verified satisfied. Otherwise fail closed.
      const nets = a.safetyNets ?? [];
      if (!downtime) {
        disposition = "blocked";
        reason = "Override only available during a declared downtime";
      } else if (nets.length === 0) {
        disposition = "blocked";
        reason = "Override unavailable — no disaster-recovery safety nets configured";
      } else if (!safetyNetsCleared) {
        disposition = "blocked";
        reason = `Override held — safety nets not yet satisfied (${nets.join(", ")})`;
      } else {
        disposition = "user_override";
        reason = `Break-glass override available — safety nets satisfied (${nets.join(", ")})`;
      }
      return { key: a.key, label: a.label, approval: a.approval, disposition, requiresApprovals, reason };
    }

    if (stepUpHeld) {
      disposition = "held";
      reason = "Held — awaiting step-up verification before any action runs";
    } else if (outcome === "deny" || outcome === "restrict") {
      disposition = "blocked";
      reason = outcome === "deny" ? "Denied — trust conditions not met" : "Restricted — action not permitted";
    } else if (outcome === "allow" || (outcome === "step_up" && stepUpSatisfied)) {
      // allow, or a satisfied step-up: apply the admin's approval configuration.
      switch (a.approval) {
        case "automated":
          disposition = "automated";
          reason = "Automated by configuration — cleared to run without human approval";
          break;
        case "admin_approval":
          disposition = "admin_approval";
          requiresApprovals = 1;
          reason = "Requires one administrator approval";
          break;
        case "dual_approval":
          disposition = "dual_approval";
          requiresApprovals = 2;
          reason = "Requires two administrator approvals (four-eyes)";
          break;
        default:
          disposition = "blocked";
          reason = "Unrecognized approval policy (fail closed)";
          break;
      }
    } else {
      // Fail closed on any unrecognized decision outcome (untyped JSON / a new
      // core outcome / an unsafe cast) — never fall through to the allow path.
      disposition = "blocked";
      reason = "Denied — unrecognized decision outcome (fail closed)";
    }
    return { key: a.key, label: a.label, approval: a.approval, disposition, requiresApprovals, reason };
  });
}

// ── grid intelligence (more signals ⇒ smarter) ──────────────────────────────

export interface GridIntelligence {
  signalsWired: number;
  signalsHealthy: number;
  flowsTotal: number;
  flowsHealthy: number;
  meanSignalsPerFlow: number;
  /** 0..100 — rises with signal coverage + healthy signals feeding flows. */
  smartnessScore: number;
}

/**
 * A coarse "how smart is the Grid right now" reading: the more (healthy) signals
 * feed the more flows, the higher the score — the intuition that each signal
 * added makes decisions tighter and break-detection faster.
 */
export function gridIntelligence(flows: Flow[], signalStates: SignalState[]): GridIntelligence {
  const wired = new Set(signalStates.map((s) => s.id));
  const healthy = new Set(signalStates.filter((s) => s.status === "healthy").map((s) => s.id));
  const usedSignals = new Set(flows.flatMap((f) => f.requiredSignals));
  const flowsHealthy = flows.filter((f) => evaluateFlowHealth(f, signalStates).status === "healthy").length;
  const meanPerFlow = flows.length ? flows.reduce((s, f) => s + f.requiredSignals.length, 0) / flows.length : 0;

  // Coverage: of the signals flows want, how many are wired + healthy.
  const wantedHealthy = [...usedSignals].filter((s) => healthy.has(s)).length;
  const coverage = usedSignals.size ? wantedHealthy / usedSignals.size : 0;
  const flowHealthRate = flows.length ? flowsHealthy / flows.length : 0;
  // Depth: more signals per flow → smarter (diminishing, capped at ~5/flow).
  const depth = Math.min(1, meanPerFlow / 5);
  const smartnessScore = Math.round(100 * (0.5 * coverage + 0.3 * flowHealthRate + 0.2 * depth));

  return {
    signalsWired: wired.size,
    signalsHealthy: healthy.size,
    flowsTotal: flows.length,
    flowsHealthy,
    meanSignalsPerFlow: Math.round(meanPerFlow * 100) / 100,
    smartnessScore,
  };
}

// ── catalog ──────────────────────────────────────────────────────────────────

import { DEMO_FLOWS } from "./catalog";
export { DEMO_FLOWS } from "./catalog";
export { FACTORY_FLOWS, FACTORY_SITUATIONS, FACTORY_SIGNAL_SOURCES } from "./factory";

// Grid coverage — which situations the Grid handles on its own given the active
// workflows + wired signals (the model behind "build the grid").
export * from "./grid-coverage";

// Signal sourcing — HOW each signal reaches the Grid (API / native / grid-collected
// / unavailable) and what that costs. The outcome depends on how the source
// systems are configured.
export * from "./signal-sourcing";
export * from "./evidence-coverage";

// Grid config — workflows as code: a declarative grid (signals + workflows +
// situations) that the CI/CD pipeline validates before the Grid runs it (GitOps).
export * from "./grid-config";

// App resilience — turn a cloud app's availability (outage / maintenance /
// degraded) into a resilience decision so staff keep working through downtime,
// with PHI-safe fallbacks. Reduces the technology-as-bottleneck / device fatigue.
export * from "./app-resilience";

// Zero-touch provisioning — a device setup recorded once as versionable config,
// validated in CI, and replayed by the Grid on serial/network join. Simulated by
// default; real enforcement only when an owner turns it on.
export * from "./provisioning";
export * from "./provisioning-order";
export * from "./provisioning-teardown";

export function listFlows(): Flow[] {
  return DEMO_FLOWS;
}
export function findFlow(id: string): Flow | undefined {
  return DEMO_FLOWS.find((f) => f.id === id);
}
