// Proof: factory-floor workflows (@workspace/flows) — automate the plant floor.
//
// The OT posture connector answers "how trustworthy is this industrial device?".
// These workflows are what the Grid DOES about it. This proves the manufacturing
// pack composes like the rest of the grid: it validates as config (governance-
// complete), covers its factory situations at health, propagates a sourcing gap
// into a coverage gap (fail-safe — an unavailable OT signal is never a green), and
// keeps the riskiest plant actions approval-gated (a firmware push or a line
// command never auto-runs).
//
// Run: pnpm --filter @workspace/scripts run proof:factory-flows

import {
  FACTORY_FLOWS,
  FACTORY_SITUATIONS,
  FACTORY_SIGNAL_SOURCES,
  evaluateGridCoverage,
  gridConfigValid,
  lintGridConfig,
  summarizeGridConfig,
  governanceScorecard,
  sourcingToSignalStates,
  summarizeSourcing,
  type GridConfig,
  type SignalSource,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Factory-floor workflows proof");
console.log(`workflows=${FACTORY_FLOWS.length} situations=${FACTORY_SITUATIONS.length} signals=${FACTORY_SIGNAL_SOURCES.length}`);

const config: GridConfig = {
  signals: [...FACTORY_SIGNAL_SOURCES],
  workflows: [...FACTORY_FLOWS],
  situations: [...FACTORY_SITUATIONS],
};

// ── validates as config, governance-complete ──────────────────────────────────
const issues = lintGridConfig(config);
check("the factory config lints with ZERO errors", issues.every((i) => i.severity !== "error"));
check("the factory config lints with ZERO warnings (governance-complete)", issues.length === 0);
check("gridConfigValid is true for the factory config", gridConfigValid(config) === true);
check("every factory situation is covered at full health (100%)", summarizeGridConfig(config).coveragePctAtFullHealth === 100);

const gov = governanceScorecard(config);
check("every factory workflow has an owner AND an accountable role", gov.owned === FACTORY_FLOWS.length && gov.accountable === FACTORY_FLOWS.length && gov.complete === true);
check("no auto-acting factory workflow lacks an accountable owner", gov.autoActingUnaccountable === 0);

// ── coverage composes; a sourcing gap fails safe ──────────────────────────────
const wired = sourcingToSignalStates(FACTORY_SIGNAL_SOURCES);
const coverage = evaluateGridCoverage(FACTORY_FLOWS, FACTORY_SITUATIONS, wired);
check("with every factory signal sourced, the Grid handles every factory situation", coverage.coveragePct === 100 && coverage.handled === FACTORY_SITUATIONS.length);

const sourcing = summarizeSourcing(FACTORY_SIGNAL_SOURCES);
check("OT posture is grid-collected (the Grid reads the device via the edge gateway)", sourcing.gridCollected >= 1 && sourcing.unavailable === 0);

// Fail-safe: make the OT signal ungettable → every OT-dependent situation drops out
// of autonomous coverage (a truthful gap, never a false green).
const gapSources: SignalSource[] = FACTORY_SIGNAL_SOURCES.map((s) => (s.id === "ot" ? { ...s, method: "unavailable" } : s));
const gapCoverage = evaluateGridCoverage(FACTORY_FLOWS, FACTORY_SITUATIONS, sourcingToSignalStates(gapSources));
check("an unavailable OT signal propagates to a coverage gap (not a green)", gapCoverage.coveragePct < 100 && gapCoverage.handled < FACTORY_SITUATIONS.length);
check("the config lint surfaces the OT gap as required-but-unavailable", lintGridConfig({ ...config, signals: gapSources }).some((i) => i.code === "required_signal_unavailable"));

// ── the riskiest plant actions are approval-gated (never auto) ─────────────────
const firmware = FACTORY_FLOWS.find((f) => f.id === "flow_plc_firmware")!;
check("a firmware PUSH to a PLC is dual-approval, never automated", firmware.actions.find((a) => a.key === "fw.push")?.approval === "dual_approval");
check("staging a firmware image IS automated (low-risk)", firmware.actions.find((a) => a.key === "fw.stage")?.approval === "automated");
check("an emergency firmware rollback is a safety-netted downtime override", (firmware.actions.find((a) => a.key === "fw.rollback")?.safetyNets?.length ?? 0) >= 1);

const line = FACTORY_FLOWS.find((f) => f.id === "flow_line_command")!;
check("issuing a line command needs admin approval, never automated", line.actions.find((a) => a.key === "line.command")?.approval === "admin_approval");

const exposure = FACTORY_FLOWS.find((f) => f.id === "flow_ot_exposure")!;
check("segmenting/quarantining an exposed OT device is dual-approval (it can stop a line)", exposure.actions.find((a) => a.key === "ot.segment")?.approval === "dual_approval");

// ── determinism ────────────────────────────────────────────────────────────────
const run = () => JSON.stringify({ lint: lintGridConfig(config), coverage: evaluateGridCoverage(FACTORY_FLOWS, FACTORY_SITUATIONS, wired) });
check("the factory pack is deterministic", run() === run());

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
