// Proof: grid config — workflows as code (@workspace/flows).
//
// The Fleet-style GitOps gate: a committed, declarative grid config
// (config/grid/example.grid.config.json) is validated on every change before the
// Grid would run it. Verifies (1) the committed config lints clean and achieves
// full coverage at health, and (2) every lint RULE actually fires on a broken
// config — a dangling signal reference, an unrunnable empty-signal workflow, a
// situation with no workflow, duplicate ids, an invalid sourcing method, and the
// soft warnings (unused signal, orphan workflow, a required-but-unavailable
// signal). Errors block a merge; warnings inform.
//
// Run: pnpm --filter @workspace/scripts run proof:grid-config

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gridConfigValid,
  lintGridConfig,
  summarizeGridConfig,
  type GridConfig,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
const codes = (c: GridConfig): string[] => lintGridConfig(c).filter((i) => i.severity === "error").map((i) => i.code);
const warnCodes = (c: GridConfig): string[] => lintGridConfig(c).filter((i) => i.severity === "warning").map((i) => i.code);

console.log("Grid config (workflows as code) proof");

// ── the committed config validates clean ──────────────────────────────────────
const configPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../config/grid/example.grid.config.json");
const committed = JSON.parse(await readFile(configPath, "utf8")) as GridConfig;
const committedIssues = lintGridConfig(committed);
check("the committed example config has ZERO errors", committedIssues.every((i) => i.severity !== "error"));
check("the committed example config has ZERO warnings", committedIssues.length === 0);
check("gridConfigValid is true for the committed config", gridConfigValid(committed) === true);
const summary = summarizeGridConfig(committed);
check("committed config: every situation covered at full health (100%)", summary.coveragePctAtFullHealth === 100);
check("committed config summary counts are consistent", summary.signals === committed.signals.length && summary.workflows === committed.workflows.length && summary.situations === committed.situations.length && summary.errors === 0);
check("committed config sourcing rollup partitions total", summary.sourcing.wireable + summary.sourcing.unavailable === summary.sourcing.total);

// ── a clean baseline we mutate per rule ───────────────────────────────────────
const base = (): GridConfig => JSON.parse(JSON.stringify(committed)) as GridConfig;

// error: a workflow requires a signal that is not declared.
const dangling = base(); dangling.workflows[0].requiredSignals = [...dangling.workflows[0].requiredSignals, "ghost_signal"];
check("unknown signal reference is an error", codes(dangling).includes("unknown_signal_ref") && !gridConfigValid(dangling));

// error: a workflow declares no required signals (can never run — fail-safe).
const empty = base(); empty.workflows[0].requiredSignals = [];
check("a workflow with no required signals is an error", codes(empty).includes("workflow_no_signals") && !gridConfigValid(empty));

// error: a situation points at a workflow that is not declared.
const orphanSit = base(); orphanSit.situations[0].workflowId = "flow_missing";
check("a situation referencing an unknown workflow is an error", codes(orphanSit).includes("unknown_workflow_ref") && !gridConfigValid(orphanSit));

// error: duplicate ids (fail closed on ambiguous config).
const dupSignal = base(); dupSignal.signals.push({ ...dupSignal.signals[0] });
check("a duplicate signal id is an error", codes(dupSignal).includes("duplicate_signal_id"));
const dupWorkflow = base(); dupWorkflow.workflows.push({ ...dupWorkflow.workflows[0] });
check("a duplicate workflow id is an error", codes(dupWorkflow).includes("duplicate_workflow_id"));
const dupSit = base(); dupSit.situations.push({ ...dupSit.situations[0] });
check("a duplicate situation id is an error", codes(dupSit).includes("duplicate_situation_id"));

// error: an unrecognized sourcing method (untyped JSON).
const badMethod = base(); (badMethod.signals[0] as { method: string }).method = "carrier-pigeon";
check("an invalid sourcing method is an error", codes(badMethod).includes("invalid_sourcing_method") && !gridConfigValid(badMethod));

// error: a workflow with no actions (covered yet executes nothing — false green).
const noActions = base(); noActions.workflows[0].actions = [];
check("a workflow with no actions is an error", codes(noActions).includes("workflow_no_actions") && !gridConfigValid(noActions));

// error: an unrecognized approval policy (runtime would fail-close it to blocked).
const badApproval = base(); (badApproval.workflows[0].actions[0] as { approval: string }).approval = "auto";
check("an invalid approval policy is an error", codes(badApproval).includes("invalid_approval_policy") && !gridConfigValid(badApproval));

// error: a missing/empty id anywhere.
const emptyId = base(); emptyId.signals[0].id = "";
check("a missing/empty id is an error", codes(emptyId).includes("missing_id") && !gridConfigValid(emptyId));

// warning: a declared signal no workflow uses.
const unused = base(); unused.signals.push({ id: "spare", name: "Spare", system: "x", method: "api" });
check("an unused signal is a warning (not an error)", warnCodes(unused).includes("unused_signal") && gridConfigValid(unused));

// warning: a workflow no situation references (orphan).
const orphanWf = base(); orphanWf.situations = orphanWf.situations.filter((s) => s.workflowId !== "flow_controlled_area");
check("a workflow no situation uses is an orphan warning", warnCodes(orphanWf).includes("orphan_workflow") && gridConfigValid(orphanWf));

// warning: a required signal that is sourced `unavailable` (guaranteed gap).
const gap = base(); (gap.signals.find((s) => s.id === "custody")!).method = "unavailable";
check("a required-but-unavailable signal is a gap warning", warnCodes(gap).includes("required_signal_unavailable") && gridConfigValid(gap));

// ── validity semantics: warnings never block, errors always do ────────────────
check("a config with only warnings is still valid", gridConfigValid(unused) && gridConfigValid(orphanWf) && gridConfigValid(gap));
check("a config with any error is invalid", !gridConfigValid(dangling) && !gridConfigValid(empty) && !gridConfigValid(badMethod));

// ── the coverage metric is null (not a reassuring number) on an INVALID config ─
// Duplicate ids dedupe downstream and would otherwise read a false 100%.
check("an invalid config reports no coverage number (null, not 100%)", summarizeGridConfig(dupSignal).coveragePctAtFullHealth === null && summarizeGridConfig(dangling).coveragePctAtFullHealth === null);
check("a valid config still reports its real coverage number", summarizeGridConfig(unused).coveragePctAtFullHealth === 100);

// ── determinism ──────────────────────────────────────────────────────────────
check("lint is deterministic", JSON.stringify(lintGridConfig(committed)) === JSON.stringify(lintGridConfig(committed)));
check("errors are ordered before warnings", (() => {
  const sev = lintGridConfig(unused).map((i) => i.severity);
  const firstWarn = sev.indexOf("warning");
  return firstWarn === -1 || !sev.slice(firstWarn).includes("error");
})());

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
