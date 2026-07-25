// Per-integration workflow TEMPLATES + a validation LINT.
//
// An integrator wiring a new app into SignalGrid clones a starter template for
// their vertical, renames the actions to their app's real operations, and runs
// the linter. The linter is a fail-closed check-and-balance: it enforces the
// same safety invariants the planner relies on (critical actions are always
// sensitive and gated; every app is mapped to a decision workflow; keys are
// well-formed) so a misconfigured integration is caught at authoring time rather
// than shipping a hole in the gate.
//
// Pure, deterministic, public-safe — no Date.now / Math.random, generic app
// CATEGORIES only (never a real vendor/product name, never PHI).

import type { AppAction, AppIntegration, AppRiskTier, AppVertical } from "./index";

/** The six supported verticals, as a runtime list (mirrors the AppVertical union). */
export const APP_VERTICALS: readonly AppVertical[] = [
  "healthcare",
  "warehouse",
  "industrial",
  "global_fleet",
  "retail",
  "data_center",
  "government",
] as const;

/** The supported risk tiers, as a runtime list (mirrors the AppRiskTier union). */
export const RISK_TIERS: readonly AppRiskTier[] = ["standard", "elevated", "critical"] as const;

export type LintSeverity = "error" | "warning";

export interface AppIntegrationIssue {
  severity: LintSeverity;
  /** Stable machine code, e.g. "critical-not-sensitive". */
  code: string;
  message: string;
  /** The offending action key, when the issue is action-scoped. */
  actionKey?: string;
}

export interface AppIntegrationLintResult {
  integrationId: string;
  /** Fail-closed: ok only when there are zero errors. */
  ok: boolean;
  errors: AppIntegrationIssue[];
  warnings: AppIntegrationIssue[];
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOTTED = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/;

const err = (code: string, message: string, actionKey?: string): AppIntegrationIssue => ({
  severity: "error",
  code,
  message,
  ...(actionKey ? { actionKey } : {}),
});
const warn = (code: string, message: string, actionKey?: string): AppIntegrationIssue => ({
  severity: "warning",
  code,
  message,
  ...(actionKey ? { actionKey } : {}),
});

function lintAction(a: AppAction, seen: Set<string>): AppIntegrationIssue[] {
  const issues: AppIntegrationIssue[] = [];
  const key = a.key ?? "";

  if (!key.trim()) {
    issues.push(err("action-key-empty", "Action key is empty."));
    return issues; // nothing else is meaningful without a key
  }
  if (seen.has(key)) issues.push(err("action-key-duplicate", `Duplicate action key "${key}".`, key));
  seen.add(key);

  if (!a.label?.trim()) issues.push(err("action-label-empty", `Action "${key}" has no label.`, key));

  // Reject an unknown risk tier FIRST (fail closed). A candidate from JSON or an
  // unsafe cast could carry a typo like "critcal" — neither "critical" nor
  // "standard" — which would slip past every tier-specific safety check below and
  // let a malformed action lint clean with sensitive:false / gatedByStepUp:false.
  if (!RISK_TIERS.includes(a.riskTier as AppRiskTier)) {
    issues.push(err("action-risktier-unknown", `Action "${key}" has unknown riskTier "${String(a.riskTier)}" — must be one of ${RISK_TIERS.join(", ")}.`, key));
  }

  // ── SAFETY invariants (fail closed) ──────────────────────────────────────────
  // A critical action is irreversible / high-consequence: it must NEVER run
  // automatically on an allow, and must never stay available under a restriction.
  if (a.riskTier === "critical" && !a.sensitive) {
    issues.push(err("critical-not-sensitive", `Critical action "${key}" must be sensitive (held for human confirmation on allow).`, key));
  }
  if (a.riskTier === "critical" && !a.gatedByStepUp) {
    issues.push(err("critical-not-gated", `Critical action "${key}" must be gated by step-up (blocked under restriction).`, key));
  }
  // A sensitive action that isn't gated could be "assist" on allow yet stay
  // available under restriction — an inconsistent, unsafe combination.
  if (a.sensitive && !a.gatedByStepUp) {
    issues.push(err("sensitive-not-gated", `Sensitive action "${key}" must also be gated by step-up.`, key));
  }

  // ── Convention / quality (warnings) ──────────────────────────────────────────
  if (!DOTTED.test(key)) {
    issues.push(warn("action-key-convention", `Action key "${key}" should be dot-namespaced, e.g. "chart.open".`, key));
  }
  if (a.riskTier === "standard" && a.sensitive) {
    issues.push(warn("standard-sensitive", `Standard action "${key}" is marked sensitive — unusual; confirm the risk tier.`, key));
  }
  return issues;
}

/**
 * Lint a single candidate integration. Fail-closed: `ok` is true only when there
 * are zero errors (warnings never block). Pure over its input.
 */
export function lintAppIntegration(candidate: AppIntegration): AppIntegrationLintResult {
  const errors: AppIntegrationIssue[] = [];
  const warnings: AppIntegrationIssue[] = [];
  const push = (i: AppIntegrationIssue) => (i.severity === "error" ? errors : warnings).push(i);

  const id = candidate.id ?? "";
  if (!id.trim()) push(err("id-empty", "Integration id is empty."));
  else if (!KEBAB.test(id)) push(warn("id-convention", `Integration id "${id}" should be kebab-case, e.g. "emr-chart".`));

  if (!candidate.name?.trim()) push(err("name-empty", "Integration name is empty."));
  if (!candidate.category?.trim()) push(err("category-empty", "Integration category is empty."));

  if (!APP_VERTICALS.includes(candidate.vertical)) {
    push(err("vertical-unknown", `Unknown vertical "${String(candidate.vertical)}" — must be one of ${APP_VERTICALS.join(", ")}.`));
  }

  // Every app must map to a decision-core workflow, or the core cannot evaluate a
  // decision for the session and the app would never be gated.
  if (!candidate.workflowKey?.trim()) {
    push(err("workflow-key-empty", "workflowKey is empty — the app would not be gated by any decision."));
  }

  const actions = candidate.actions ?? [];
  if (actions.length === 0) {
    push(err("no-actions", "Integration defines no actions."));
  }

  const seen = new Set<string>();
  for (const a of actions) for (const i of lintAction(a, seen)) push(i);

  // Design recommendation: keep at least one non-gated read/ack so the app can
  // always SEE even under a restriction ("see, even when you can't act").
  if (actions.length > 0 && !actions.some((a) => !a.gatedByStepUp)) {
    push(warn("no-visible-read", "No non-gated action — the app would show nothing under a restriction. Keep a low-risk read available."));
  }

  return { integrationId: id, ok: errors.length === 0, errors, warnings };
}

/**
 * Lint a whole catalog: each integration individually, plus a cross-integration
 * duplicate-id check (ids must be unique so `findAppIntegration` is unambiguous).
 */
export function lintAppIntegrations(list: AppIntegration[]): AppIntegrationLintResult[] {
  const results = list.map(lintAppIntegration);
  const idCounts = new Map<string, number>();
  for (const i of list) idCounts.set(i.id, (idCounts.get(i.id) ?? 0) + 1);
  for (const r of results) {
    if ((idCounts.get(r.integrationId) ?? 0) > 1) {
      const dup = err("id-duplicate", `Integration id "${r.integrationId}" is not unique across the catalog.`);
      r.errors.push(dup);
      // Recompute fail-closed status after adding the cross-integration error.
      (r as { ok: boolean }).ok = false;
    }
  }
  return results;
}

/** True when every integration in the list lints clean (no errors). */
export function catalogLintsClean(list: AppIntegration[]): boolean {
  return lintAppIntegrations(list).every((r) => r.ok);
}

// ── starter templates ────────────────────────────────────────────────────────
// One clone-me template per vertical. Each is a VALID, lint-clean AppIntegration
// with a representative action at each disposition (a visible read, an elevated
// write, and a critical/sensitive action), and TODO placeholders the integrator
// replaces with their app's real operations. The `<vertical>-app` id and the
// TODO labels make it obvious these are scaffolds, not shipping integrations.

const CONFIRMED_WORKFLOW: Record<AppVertical, string> = {
  healthcare: "clinical-session",
  warehouse: "pick-pack",
  industrial: "line-ops",
  global_fleet: "field-session",
  retail: "pos-session",
  data_center: "noc-session",
  government: "gov-case-session",
};

function templateFor(vertical: AppVertical): AppIntegration {
  return {
    id: `${vertical.replace(/_/g, "-")}-app-template`,
    name: "TODO: your app name (generic category)",
    category: "TODO: short category",
    vertical,
    // Map to the decision workflow the core should evaluate for this session.
    workflowKey: CONFIRMED_WORKFLOW[vertical],
    actions: [
      // A low-risk read stays available even under a restriction.
      { key: "session.view", label: "TODO: view (low-risk read)", riskTier: "standard", sensitive: false, gatedByStepUp: false },
      // An elevated write is held on step-up, blocked on restriction.
      { key: "record.write", label: "TODO: write (elevated)", riskTier: "elevated", sensitive: false, gatedByStepUp: true },
      // A critical action is ALWAYS sensitive + gated (irreversible / high-consequence).
      { key: "action.commit", label: "TODO: irreversible action (critical)", riskTier: "critical", sensitive: true, gatedByStepUp: true },
    ],
  };
}

/** A clone-me starter template per vertical; each lints clean. */
export const STARTER_TEMPLATES: Record<AppVertical, AppIntegration> = {
  healthcare: templateFor("healthcare"),
  warehouse: templateFor("warehouse"),
  industrial: templateFor("industrial"),
  global_fleet: templateFor("global_fleet"),
  retail: templateFor("retail"),
  data_center: templateFor("data_center"),
  government: templateFor("government"),
};

/** Return a fresh starter template for a vertical (a deep copy, safe to mutate). */
export function starterTemplate(vertical: AppVertical): AppIntegration {
  const t = STARTER_TEMPLATES[vertical];
  return { ...t, actions: t.actions.map((a) => ({ ...a })) };
}
