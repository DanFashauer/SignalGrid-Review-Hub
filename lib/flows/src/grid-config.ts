// Grid config — workflows as code. A declarative, version-controlled description
// of an organization's grid: the signals it sources (and how), the workflows that
// act, and the situations those workflows cover. Author it, put it in Git, and the
// CI/CD pipeline validates it on every change (the Fleet-style GitOps model, here
// applied to decision orchestration) before the Grid runs it.
//
// lintGridConfig is the validator: it catches the mistakes that would otherwise
// become silent gaps — a workflow that references a signal nobody declared, a
// workflow with no signals (can't run — fail-safe), a situation pointing at a
// workflow that doesn't exist, duplicate ids, an invalid sourcing method — and
// flags softer issues (an unused signal, an orphan workflow, a guaranteed gap
// where a required signal is `unavailable`). Errors block; warnings inform.
//
// Pure and deterministic. No I/O — a caller loads the JSON/YAML and passes it in.

import type { Flow, SignalState } from "./index";
import { evaluateGridCoverage, type GridSituation } from "./grid-coverage";
import { type AcquisitionMethod, type SignalSource, sourcingToSignalStates, summarizeSourcing } from "./signal-sourcing";

/** A whole grid, as authored config: signals (+ how sourced), workflows, situations. */
export interface GridConfig {
  signals: SignalSource[];
  workflows: Flow[];
  situations: GridSituation[];
}

export type LintSeverity = "error" | "warning";

export interface GridConfigIssue {
  severity: LintSeverity;
  /** Stable machine code for the rule that fired. */
  code: string;
  /** What/where — the offending id, so the author can jump to it. */
  subject: string;
  message: string;
}

const VALID_METHODS: readonly AcquisitionMethod[] = ["api", "native", "grid_collected", "unavailable"];
// Mirrors ApprovalPolicy in ./index — an allowlist, so a typo'd/unknown approval
// (which planFlowActions fail-closes to "blocked" at runtime) is caught at author
// time instead of silently executing nothing.
const VALID_APPROVALS: readonly string[] = ["automated", "admin_approval", "dual_approval", "user_override_on_downtime"];

/**
 * Validate a grid config. Fail-safe by design: anything that would let the Grid
 * silently under-deliver is an ERROR (a dangling signal reference, an unrunnable
 * empty-signal workflow, a situation with no workflow, duplicate ids, an
 * unrecognized sourcing method). Softer, non-breaking observations (an unused
 * signal, a workflow no situation uses, a required signal that is `unavailable`
 * and therefore a guaranteed gap) are WARNINGS. Deterministic: issues come back
 * in a stable order (errors first, then warnings, each in declaration order).
 */
export function lintGridConfig(config: GridConfig): GridConfigIssue[] {
  const errors: GridConfigIssue[] = [];
  const warnings: GridConfigIssue[] = [];

  const signals = config.signals ?? [];
  const workflows = config.workflows ?? [];
  const situations = config.situations ?? [];

  // Duplicate ids (fail closed — an ambiguous config must not "mostly work").
  const dupe = (ids: string[], kind: string, code: string): Set<string> => {
    const seen = new Set<string>();
    const flagged = new Set<string>();
    for (const id of ids) {
      if (seen.has(id) && !flagged.has(id)) {
        flagged.add(id);
        errors.push({ severity: "error", code, subject: id, message: `Duplicate ${kind} id "${id}".` });
      }
      seen.add(id);
    }
    return seen;
  };
  const signalIds = dupe(signals.map((s) => s.id), "signal", "duplicate_signal_id");
  dupe(workflows.map((w) => w.id), "workflow", "duplicate_workflow_id");
  dupe(situations.map((s) => s.id), "situation", "duplicate_situation_id");
  const workflowIds = new Set(workflows.map((w) => w.id));

  // Signals: every one must declare a recognized sourcing method.
  for (const s of signals) {
    if (!VALID_METHODS.includes(s.method)) {
      errors.push({ severity: "error", code: "invalid_sourcing_method", subject: s.id, message: `Signal "${s.id}" has an unrecognized sourcing method "${String(s.method)}"; expected one of ${VALID_METHODS.join(", ")}.` });
    }
  }

  // Every entity needs a non-empty id (an empty/missing id is un-referenceable).
  const flagMissingId = (items: { id?: string }[], kind: string): void => {
    items.forEach((it, i) => {
      if (typeof it.id !== "string" || it.id.length === 0) {
        errors.push({ severity: "error", code: "missing_id", subject: `${kind}[${i}]`, message: `A ${kind} at index ${i} has a missing or empty id.` });
      }
    });
  };
  flagMissingId(signals, "signal");
  flagMissingId(workflows, "workflow");
  flagMissingId(situations, "situation");

  // Workflows: must require ≥1 signal AND declare ≥1 action, every required signal
  // must be declared, and every action's approval policy must be recognized.
  const usedSignals = new Set<string>();
  for (const w of workflows) {
    const reqs = w.requiredSignals ?? [];
    if (reqs.length === 0) {
      errors.push({ severity: "error", code: "workflow_no_signals", subject: w.id, message: `Workflow "${w.id}" declares no required signals; a workflow with no inputs can never run (it would be a false green).` });
    }
    for (const sig of reqs) {
      usedSignals.add(sig);
      if (!signalIds.has(sig)) {
        errors.push({ severity: "error", code: "unknown_signal_ref", subject: w.id, message: `Workflow "${w.id}" requires signal "${sig}", which is not declared in signals.` });
      }
    }
    const actions = w.actions ?? [];
    if (actions.length === 0) {
      errors.push({ severity: "error", code: "workflow_no_actions", subject: w.id, message: `Workflow "${w.id}" declares no actions; it would be reported as covered yet execute nothing (a false green).` });
    }
    for (const a of actions) {
      if (!VALID_APPROVALS.includes(a.approval)) {
        errors.push({ severity: "error", code: "invalid_approval_policy", subject: w.id, message: `Workflow "${w.id}" action "${a.key}" has an unrecognized approval policy "${String(a.approval)}"; expected one of ${VALID_APPROVALS.join(", ")} (it would be blocked at runtime).` });
      }
    }
  }

  // Situations: each must point at a declared workflow.
  const usedWorkflows = new Set<string>();
  for (const sit of situations) {
    usedWorkflows.add(sit.workflowId);
    if (!workflowIds.has(sit.workflowId)) {
      errors.push({ severity: "error", code: "unknown_workflow_ref", subject: sit.id, message: `Situation "${sit.id}" points at workflow "${sit.workflowId}", which is not declared.` });
    }
  }

  // Warnings — non-breaking, but worth surfacing.
  for (const s of signals) {
    if (!usedSignals.has(s.id)) {
      warnings.push({ severity: "warning", code: "unused_signal", subject: s.id, message: `Signal "${s.id}" is declared but no workflow requires it.` });
    }
  }
  for (const w of workflows) {
    if (!usedWorkflows.has(w.id)) {
      warnings.push({ severity: "warning", code: "orphan_workflow", subject: w.id, message: `Workflow "${w.id}" handles no situation (no situation references it).` });
    }
  }
  // A required signal that is sourced `unavailable` is a guaranteed coverage gap.
  const methodById = new Map(signals.map((s) => [s.id, s.method] as const));
  for (const w of workflows) {
    for (const sig of w.requiredSignals ?? []) {
      if (methodById.get(sig) === "unavailable") {
        warnings.push({ severity: "warning", code: "required_signal_unavailable", subject: w.id, message: `Workflow "${w.id}" requires signal "${sig}", which is sourced "unavailable" — a guaranteed gap until it can be wired or grid-collected.` });
      }
    }
  }

  return [...errors, ...warnings];
}

/** True when the config has zero ERROR-severity issues (warnings are allowed). */
export function gridConfigValid(config: GridConfig): boolean {
  return lintGridConfig(config).every((i) => i.severity !== "error");
}

export interface GridConfigSummary {
  signals: number;
  workflows: number;
  situations: number;
  errors: number;
  warnings: number;
  /** Sourcing rollup (vendor-integrated vs grid-lifted vs gap). */
  sourcing: ReturnType<typeof summarizeSourcing>;
  /**
   * Coverage the config achieves at full health (situations the Grid handles
   * itself) — or `null` when the config has ERRORS, because coverage computed on
   * an invalid config is not a trustworthy number (e.g. duplicate ids dedupe to a
   * falsely reassuring 100%). Only meaningful when `errors === 0`.
   */
  coveragePctAtFullHealth: number | null;
}

/**
 * Summarize a config: counts, lint tallies, sourcing rollup, and the coverage it
 * would achieve if every wireable signal were healthy (the ceiling this config's
 * sourcing posture allows — `unavailable` signals still cap it, honestly).
 */
export function summarizeGridConfig(config: GridConfig): GridConfigSummary {
  const issues = lintGridConfig(config);
  const errors = issues.filter((i) => i.severity === "error").length;
  const wired: SignalState[] = sourcingToSignalStates(config.signals ?? []);
  const coverage = evaluateGridCoverage(config.workflows ?? [], config.situations ?? [], wired);
  return {
    signals: (config.signals ?? []).length,
    workflows: (config.workflows ?? []).length,
    situations: (config.situations ?? []).length,
    errors,
    warnings: issues.filter((i) => i.severity === "warning").length,
    sourcing: summarizeSourcing(config.signals ?? []),
    // Only report coverage for a VALID config — never let an invalid one advertise 100%.
    coveragePctAtFullHealth: errors === 0 ? coverage.coveragePct : null,
  };
}
