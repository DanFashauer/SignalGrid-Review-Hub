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
import type { SourcingProjection } from "./signal-sourcing";

/**
 * What the coverage numbers were computed FROM. Derived from the argument's shape,
 * never passed in — a caller cannot mislabel a projection as an observation, and a
 * caller cannot forget to label one either.
 *
 * - `observed`               — real signal states. Coverage is a present-tense fact.
 * - `projected_from_sourcing` — states inferred from acquisition method alone. Nothing
 *   was contacted, so coverage is a CEILING: what the Grid would handle once every
 *   wireable signal is actually wired and healthy. `unavailable` sources still cap it.
 */
export type CoverageBasis = "observed" | "projected_from_sourcing";

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
  /**
   * What these numbers were computed from. Read it before reading anything else:
   * under `projected_from_sourcing` every figure below is a CEILING, not a
   * measurement.
   */
  basis: CoverageBasis;
  /** Count auto-handled by the Grid with no human in the loop. */
  handled: number;
  /** Workflow active but under-fed. */
  partial: number;
  /** No active workflow at all. */
  blindSpots: number;
  total: number;
  /**
   * 0..100 — share of situations covered.
   *
   * Under `basis: "observed"` this is what the Grid handles autonomously right now.
   * Under `basis: "projected_from_sourcing"` it is the CEILING that sourcing posture
   * allows — what would be handled once every wireable signal is wired and healthy.
   * The two are not interchangeable and the field name deliberately does not say
   * which it is; `basis` does.
   */
  coveragePct: number;
}

/**
 * Evaluate how much of the situation set the Grid handles on its own, given the
 * currently ACTIVE workflows and the signal states supplied.
 *
 * Read `result.basis` before reading `result.coveragePct`. Pass a `SignalState[]`
 * and you get a measurement of now; pass a `SourcingProjection` and you get a
 * ceiling, with every reason string reworded to say so. The basis is DERIVED from
 * the argument's shape — there is no flag to set and therefore none to get wrong.
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
  wiredSignals: readonly SignalState[] | SourcingProjection,
): GridCoverage {
  // Derive the basis from what was handed in. A projection can only be built by
  // projectSourcingAsSignalStates, so this is the one place the distinction has to
  // be read and it cannot be spoofed by a caller passing the wrong flag.
  const projected = !Array.isArray(wiredSignals);
  const basis: CoverageBasis = projected ? "projected_from_sourcing" : "observed";
  // Group active workflows by id. When several active workflows share an id we
  // keep them ALL and require every one to be healthy (most-restrictive wins),
  // so a healthy duplicate can never mask a genuinely-broken flow of the same id.
  const byId = new Map<string, Flow[]>();
  for (const wf of activeWorkflows) {
    const list = byId.get(wf.id);
    if (list) list.push(wf);
    else byId.set(wf.id, [wf]);
  }
  const states: SignalState[] = projected
    ? [...(wiredSignals as SourcingProjection).states]
    : [...(wiredSignals as readonly SignalState[])];

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
        // The projected wording is the correction this whole change exists for.
        // "is active and fully fed" states a present operational fact; under a
        // projection nothing was contacted, so the only true statement available is
        // about the sources being wireable and what that WOULD yield.
        reason: projected
          ? `${name} is active and every signal it requires has a wireable source — once they are wired and healthy the Grid would run its response by itself. Nothing here was observed.`
          : `${name} is active and fully fed — the Grid runs its response by itself.`,
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

  return { situations: results, basis, handled, partial, blindSpots, total, coveragePct };
}

// ── public-safe demo situations, tied to the demo flows ──────────────────────
// One situation per DEMO_FLOWS entry — what that workflow exists to catch.

/** Illustrative situations mapped to the demo flows (see ./catalog). */
export const GRID_SITUATIONS: readonly GridSituation[] = [
  { id: "sit_med_admin", label: "Unsafe medication administration on a shared device", workflowId: "flow_med_admin" },
  { id: "sit_network_change", label: "Unauthorized network change from a NOC workstation", workflowId: "flow_network_change" },
  { id: "sit_controlled_area", label: "Unbadged entry to a controlled area", workflowId: "flow_controlled_area" },
];
