// Capstone: the grid lifecycle end to end (@workspace/flows).
//
// The per-model proofs verify provisioning, signal-sourcing, grid-config,
// grid-coverage and app-resilience in isolation. This proves they COMPOSE into
// the "build the grid" story the vision describes, on one shared clinical tablet:
//
//   1. PROVISION   — a new tablet boots; the recorded setup applies zero-touch
//                    (simulated), the kiosk-lockdown step held for approval.
//   2. SOURCE      — its signals reach the Grid by different paths (API / native /
//                    grid-collected); an ungettable source is a gap, not a green.
//   3. VALIDATE    — the org's grid (workflows + situations + sources) lints clean
//                    as config before the Grid runs it.
//   4. COVER       — with the sourced signals wired, the Grid computes which
//                    situations it handles on its own; a sourcing gap becomes a
//                    coverage gap (fail-safe propagation).
//   5. RESILE      — mid-shift the EHR has an unplanned outage; staff keep working
//                    on a PHI-safe fallback — but never without safety nets.
//   6. DECOMMISSION— the tablet is retired; but it is only deploy-ready in the
//                    first place because its REVERSAL was proven (dependency-
//                    ordered, clean-state-verified), rehearsed simulated. Signals
//                    in, decisions made, and a clean, proven exit.
//
// Fully offline, deterministic, public-safe.
//
// Run: pnpm --filter @workspace/scripts run proof:grid-lifecycle

import {
  DEMO_FLOWS,
  GRID_SITUATIONS,
  evaluateGridCoverage,
  gridConfigValid,
  lintGridConfig,
  planZeroTouchSetup,
  planTeardown,
  deployReady,
  teardownProven,
  resolveAppResilience,
  fleetResilience,
  setupRecordingValid,
  sourcingToSignalStates,
  summarizeGridConfig,
  summarizeSourcing,
  type AppService,
  type DeviceSetupRecording,
  type GridConfig,
  type SignalSource,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Grid-lifecycle capstone — a shared clinical tablet, end to end");

// ── 1. PROVISION — the tablet is set up zero-touch (simulated) ─────────────────
const recording: DeviceSetupRecording = {
  id: "rec_clinical_tablet",
  name: "Clinical tablet first-boot",
  match: { serialPrefix: "CLIN-", model: "MediPad-X" },
  triggers: ["first_boot", "network_join"],
  steps: [
    { key: "wifi", label: "Join clinical Wi-Fi", kind: "wifi" },
    { key: "profile", label: "Install MDM profile", kind: "profile" },
    { key: "emr", label: "Deploy EMR app + management extension", kind: "app_install" },
    { key: "lockdown", label: "Apply kiosk restriction", kind: "restriction", sensitive: true },
  ],
  // The reversal, recorded up front — deploy-ready means the retreat is proven.
  // Dependency order: deactivate the app/extension first (restart-gated), then the
  // restriction, the Wi-Fi, and the MDM profile LAST; end with a clean-state check.
  teardown: {
    steps: [
      { key: "emr", label: "Deactivate + remove EMR extension", action: "deactivate", requiresRestart: true },
      { key: "lockdown", label: "Remove kiosk restriction", action: "remove", sensitive: true },
      { key: "wifi", label: "Remove Wi-Fi config", action: "remove" },
      { key: "profile", label: "Remove MDM profile", action: "remove" },
    ],
    verifyClean: true,
  },
};
const tablet = { serial: "CLIN-00042", model: "MediPad-X", onNetwork: true };
check("the provisioning recording is valid", setupRecordingValid(recording));
const provision = planZeroTouchSetup(recording, tablet); // default: simulated
check("a new tablet matches and is planned (simulated — nothing runs yet)", provision.matched && provision.willApplyAnything === false && provision.steps.every((s) => s.disposition === "held_simulated"));
// A different device on the floor is untouched by this recording.
check("an unrelated device is never touched by the tablet recording", planZeroTouchSetup(recording, { serial: "WARE-1", model: "Handheld" }).matched === false);

// ── 2. SOURCE — the tablet's signals reach the Grid by different paths ──────────
// The Grid's workflows (DEMO_FLOWS) need: identity, device_compliance, badge_binding,
// baseline, change_window, custody. Each is obtained the way its source allows.
const src = (id: string, system: string, method: SignalSource["method"]): SignalSource => ({ id, name: id, system, method });
const sources: SignalSource[] = [
  src("identity", "Entra ID", "api"),
  src("device_compliance", "Intune", "api"),
  src("badge_binding", "RFID reader", "native"),
  src("baseline", "CIS scanner", "grid_collected"),
  src("change_window", "ITSM", "native"),
  src("custody", "RTLS", "grid_collected"),
];
const sourcing = summarizeSourcing(sources);
check("the tablet's signals are all wireable (vendor-integrated or grid-lifted)", sourcing.wireable === sources.length && sourcing.unavailable === 0);
check("some signals are grid-lifted (the Grid does the lifting where APIs can't)", sourcing.gridCollected === 2 && sourcing.vendorIntegrated === 4);

// ── 3. VALIDATE — the org's grid validates as config ───────────────────────────
const config: GridConfig = { signals: sources, workflows: [...DEMO_FLOWS], situations: [...GRID_SITUATIONS] };
check("the composed grid config lints clean (zero errors)", lintGridConfig(config).every((i) => i.severity !== "error") && gridConfigValid(config));
check("the config would fully cover its situations at health", summarizeGridConfig(config).coveragePctAtFullHealth === 100);

// ── 4. COVER — with the sourced signals wired, what does the Grid handle? ───────
const wired = sourcingToSignalStates(sources);
const coverage = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, wired);
check("with every signal sourced, the Grid handles every situation itself", coverage.coveragePct === 100 && coverage.handled === GRID_SITUATIONS.length);

// Fail-safe propagation: an ungettable source becomes a coverage gap, not a green.
const withGap: SignalSource[] = sources.map((s) => (s.id === "custody" ? { ...s, method: "unavailable" } : s));
const gapWired = sourcingToSignalStates(withGap);
const gapCoverage = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, gapWired);
const areaSituation = gapCoverage.situations.find((r) => r.workflowId === "flow_controlled_area")!;
check("an unavailable source propagates to a coverage gap (custody → controlled-area not handled)", areaSituation.status !== "auto_handled" && gapCoverage.coveragePct < 100);
check("the config lint SURFACES that gap as a required-but-unavailable warning", lintGridConfig({ ...config, signals: withGap }).some((i) => i.code === "required_signal_unavailable"));

// ── 5. RESILE — an EHR outage mid-shift; staff keep working, PHI-safely ─────────
const suite: AppService[] = [
  { id: "ehr", name: "EHR", availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["DR checkpoint", "post-hoc reconciliation", "witness"] },
  { id: "bcma", name: "BCMA", availability: "available", hasFallback: true, handlesPhi: true },
  { id: "his", name: "HIS", availability: "degraded", hasFallback: false, handlesPhi: false },
];
const ehr = resolveAppResilience(suite[0]);
check("an EHR outage with a safety-netted fallback lets staff keep working", ehr.mode === "downtime_fallback" && ehr.canProceed && ehr.requiredSafetyNets.length === 3);
// The headline fail-safe still holds in the composition: strip the nets → blocked.
const ehrNoNets = resolveAppResilience({ ...suite[0], safetyNets: [] });
check("the same EHR outage WITHOUT safety nets is blocked (PHI fail-safe holds)", ehrNoNets.mode === "blocked_no_fallback" && !ehrNoNets.canProceed);
const fleet = fleetResilience(suite);
check("the app suite rollup is consistent (nothing blocked here)", fleet.total === 3 && fleet.blocked === 0 && fleet.workable === 3);

// ── 6. DECOMMISSION — the tablet is retired only because its reversal is proven ─
// The recording is deploy-ready only because a dependency-ordered, clean-state-
// verified teardown was recorded up front (setup valid AND teardown proven).
check("the tablet is deploy-ready — its reversal was proven, not deferred", teardownProven(recording) && deployReady(recording));
// Rehearse the decommission: simulated by default, nothing removed for real, but
// the clean-state check is part of the plan.
const decommission = planTeardown(recording, tablet);
check("decommission is a simulated rehearsal by default (nothing removed for real)", decommission.matched && decommission.willRemoveAnything === false && decommission.steps.every((s) => s.disposition === "held_simulated"));
check("the decommission rehearsal deactivates the extension first, profile last, and verifies clean", decommission.steps[0].key === "emr" && decommission.steps[0].action === "deactivate" && decommission.steps[decommission.steps.length - 1].key === "profile" && decommission.verifiesClean);
// Fail-safe both ways: an unrelated device is never torn down by this recording…
check("an unrelated device is never decommissioned by the tablet recording", planTeardown(recording, { serial: "WARE-1", model: "Handheld" }).matched === false);
// …and without the recorded reversal, the SAME setup is NOT deploy-ready.
const noReversal: DeviceSetupRecording = { ...recording, teardown: undefined };
check("strip the recorded reversal and the setup is no longer deploy-ready (retreat unproven)", setupRecordingValid(noReversal) && !deployReady(noReversal));

// ── determinism of the whole lifecycle ──────────────────────────────────────────
const run = () => JSON.stringify({
  provision: planZeroTouchSetup(recording, tablet),
  coverage: evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, sourcingToSignalStates(sources)),
  ehr: resolveAppResilience(suite[0]),
  decommission: planTeardown(recording, tablet),
});
check("the end-to-end lifecycle is deterministic", run() === run());

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
