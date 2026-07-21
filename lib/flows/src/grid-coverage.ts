// Grid coverage — the model behind "build the grid": given the workflows an
// administrator has ACTIVATED and the signals they have WIRED, which real-world
// situations can the Grid handle entirely on its own?
//
// A situation is caught only when BOTH are true: its workflow is active AND every
// signal that workflow needs is wired and healthy. Miss either and it is not
// handled — the fix is always to ADD (wire the missing signal, or activate the
// workflow). This is the honest, fail-safe core the interactive demo visualizes:
// coverage only ever rises as you add, and a situation is NEVER reported handled
// unless the Grid can actually run its response.
//
// Pure and deterministic. Reuses evaluateFlowHealth so the fail-closed signal
// semantics (missing/broken/stale) are defined in exactly one place.

import { evaluateFlowHealth, type Flow, type SignalState } from "./index";

/**
 * How well the Grid covers a situation right now:
 * - `auto_handled` — workflow active AND all required signals wired + healthy;
 *   the Grid runs the response by itself.
 * - `partial`      — workflow active but one or more required signals are
 *   missing/broken/stale; it cannot fully run yet.
 * - `blind_spot`   — no active workflow handles this situation at all.
 */
export type SituationCoverage = "auto_handled" | "partial" | "blind_spot";

/** A real-world situation the Grid should catch, and the workflow that handles it. */
export interface GridSituation {
  id: string;
  label: string;
  /** Id of the workflow (Flow) that handles this situation when active + fed. */
  workflowId: string;
}

export interface SituationCoverageResult {
  situationId: string;
  label: string;
  workflowId: string;
  status: SituationCoverage;
  /** Required signals not yet wired/healthy (why it is not handled). Empty when auto_handled. */
  missingSignals: string[];
  reason: string;
}

export interface GridCoverage {
  situations: SituationCoverageResult[];
  /** Count auto-handled by the Grid with no human in the loop. */
  handled: number;
  /** Workflow active but under-fed. */
  partial: number;
  /** No active workflow at all. */
  blindSpots: number;
  total: number;
  /** 0..100 — share of situations the Grid handles autonomously right now. */
  coveragePct: number;
}

/**
 * Evaluate how much of the situation set the Grid handles on its own, given the
 * currently ACTIVE workflows and the currently WIRED signal states.
 *
 * Fail-safe: a situation resolves to `auto_handled` ONLY when its workflow is in
 * `activeWorkflows`, that workflow declares at least one required signal, and its
 * health is exactly "healthy" (every required signal wired and healthy). Anything
 * else — no active workflow, a missing/broken signal, a merely stale one, or a
 * workflow that requires no signals at all (no inputs ⇒ cannot run) — is reported
 * as `blind_spot` or `partial`, never handled. Adding a healthy signal or a
 * workflow only ever raises coverage; the sole way coverage falls is wiring a
 * signal in a WORSE state (e.g. broken), which is the fail-closed direction.
 */
export function evaluateGridCoverage(
  activeWorkflows: readonly Flow[],
  situations: readonly GridSituation[],
  wiredSignals: readonly SignalState[],
): GridCoverage {
  // Group active workflows by id. When several active workflows share an id we
  // keep them ALL and require every one to be healthy (most-restrictive wins),
  // so a healthy duplicate can never mask a genuinely-broken flow of the same id.
  const byId = new Map<string, Flow[]>();
  for (const wf of activeWorkflows) {
    const list = byId.get(wf.id);
    if (list) list.push(wf);
    else byId.set(wf.id, [wf]);
  }
  const states = [...wiredSignals];

  const results: SituationCoverageResult[] = situations.map((sit) => {
    const flows = byId.get(sit.workflowId) ?? [];
    if (flows.length === 0) {
      return {
        situationId: sit.id,
        label: sit.label,
        workflowId: sit.workflowId,
        status: "blind_spot",
        missingSignals: [],
        reason: "No active workflow handles this situation — build one.",
      };
    }
    // Fail-safe: a workflow that requires NO signals has no inputs — it cannot
    // detect or respond to the situation, so it is never `auto_handled` (that
    // would be a false green over a threat the Grid has no sensor for). Treat an
    // empty-requirement flow as active-but-not-runnable (partial).
    const zeroSignal = flows.some((f) => f.requiredSignals.length === 0);
    const healths = flows.map((f) => evaluateFlowHealth(f, states));
    const allHealthy = !zeroSignal && healths.every((h) => h.status === "healthy");
    const name = flows[0].name;
    if (allHealthy) {
      return {
        situationId: sit.id,
        label: sit.label,
        workflowId: sit.workflowId,
        status: "auto_handled",
        missingSignals: [],
        reason: `${name} is active and fully fed — the Grid runs its response by itself.`,
      };
    }
    // Active but not runnable: some required signal is broken/missing/stale, or
    // the workflow declares no signals at all. Fail-safe — never auto_handled.
    const missingSignals = [...new Set(healths.flatMap((h) => [...h.brokenSignals, ...h.staleSignals]))];
    const reason = zeroSignal
      ? `${name} is active but declares no required signals — wire at least one for the Grid to run it.`
      : `${name} is active but needs signal(s) ${missingSignals.join(", ")} wired.`;
    return {
      situationId: sit.id,
      label: sit.label,
      workflowId: sit.workflowId,
      status: "partial",
      missingSignals,
      reason,
    };
  });

  const handled = results.filter((r) => r.status === "auto_handled").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const blindSpots = results.filter((r) => r.status === "blind_spot").length;
  const total = results.length;
  const coveragePct = total ? Math.round((handled / total) * 100) : 0;

  return { situations: results, handled, partial, blindSpots, total, coveragePct };
}

// ── public-safe demo situations, tied to the demo flows ──────────────────────
// One situation per DEMO_FLOWS entry — what that workflow exists to catch.

/** Illustrative situations mapped to the demo flows (see ./catalog). */
export const GRID_SITUATIONS: readonly GridSituation[] = [
  { id: "sit_med_admin", label: "Unsafe medication administration on a shared device", workflowId: "flow_med_admin" },
  { id: "sit_network_change", label: "Unauthorized network change from a NOC workstation", workflowId: "flow_network_change" },
  { id: "sit_controlled_area", label: "Unbadged entry to a controlled area", workflowId: "flow_controlled_area" },
];
