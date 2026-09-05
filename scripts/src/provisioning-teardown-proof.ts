// Proof: provisioning teardown-proof (@workspace/flows) — prove the retreat
// before you trust the deploy.
//
// Verifies that a recording is deploy-ready ONLY when its setup is valid AND its
// reversal is proven: every setup step is reversed, the agent/extension is
// deactivated (not just deleted) with a restart acknowledged, the allow profile
// is torn down LAST (reverse-dependency order so nothing is stranded), and a
// clean-state check confirms nothing stayed registered. The decommission planner
// is fail-safe: an unproven teardown never runs; nothing is removed for real
// unless an owner enabled enforcement; a sensitive removal needs approval.
//
// Run: pnpm --filter @workspace/scripts run proof:provisioning-teardown

import {
  deployReady,
  lintTeardown,
  planTeardown,
  setupRecordingValid,
  teardownProven,
  type DeviceSetupRecording,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
const errCodes = (r: DeviceSetupRecording): string[] => lintTeardown(r).filter((i) => i.severity === "error").map((i) => i.code);
const warnCodes = (r: DeviceSetupRecording): string[] => lintTeardown(r).filter((i) => i.severity === "warning").map((i) => i.code);

console.log("Provisioning teardown-proof");

// A deploy-ready recording: a shared clinical Mac with a security agent, and a
// proven reversal. Setup installs an allow profile then the agent (system
// extension) then a lockdown; teardown reverses in dependency order — deactivate
// the extension FIRST (restart-gated), then the restriction, wifi, and the allow
// profile LAST, ending with a clean-state check.
const good: DeviceSetupRecording = {
  id: "rec_clinical_mac",
  name: "Clinical Mac first-boot",
  match: { serialPrefix: "CMAC-", model: "MacBook-Frontline" },
  triggers: ["first_boot", "network_join"],
  steps: [
    { key: "wifi", label: "Join clinical Wi-Fi", kind: "wifi" },
    { key: "pppc", label: "Install PPPC/TCC allow profile", kind: "profile" },
    { key: "agent", label: "Install security agent + system extension", kind: "app_install" },
    { key: "lockdown", label: "Apply kiosk restriction", kind: "restriction", sensitive: true },
  ],
  teardown: {
    steps: [
      { key: "agent", label: "Deactivate + remove agent extension", action: "deactivate", requiresRestart: true },
      { key: "lockdown", label: "Remove kiosk restriction", action: "remove", sensitive: true },
      { key: "wifi", label: "Remove Wi-Fi config", action: "remove" },
      { key: "pppc", label: "Remove PPPC/TCC allow profile", action: "remove" },
    ],
    verifyClean: true,
  },
};
check("a deploy-ready recording has zero teardown errors", errCodes(good).length === 0);
check("it surfaces the restart requirement as a warning", warnCodes(good).includes("restart_required"));
check("setup is valid AND teardown is proven → deployReady", setupRecordingValid(good) && teardownProven(good) && deployReady(good));

// ── fail-safe: each way a reversal can be unsafe is an ERROR ─────────────────────

// No teardown at all — not deploy-ready.
const noTeardown: DeviceSetupRecording = { ...good, teardown: undefined };
check("no recorded teardown → error + not deploy-ready", errCodes(noTeardown).includes("teardown_missing") && !deployReady(noTeardown));

// A setup step left unreversed — it would be left behind.
const unreversed: DeviceSetupRecording = { ...good, teardown: { verifyClean: true, steps: good.teardown!.steps.filter((s) => s.key !== "pppc") } };
check("a setup step with no reversal → setup_step_unreversed", errCodes(unreversed).includes("setup_step_unreversed") && !teardownProven(unreversed));

// A teardown step that reverses nothing.
const orphanTeardown: DeviceSetupRecording = { ...good, teardown: { verifyClean: true, steps: [...good.teardown!.steps, { key: "ghost", label: "Remove nothing", action: "remove" }] } };
check("a teardown step reversing no setup step → teardown_step_unmatched", errCodes(orphanTeardown).includes("teardown_step_unmatched"));

// The extension merely 'remove'd, not 'deactivate'd — it stays active.
const notDeactivated: DeviceSetupRecording = {
  ...good,
  teardown: { verifyClean: true, steps: good.teardown!.steps.map((s) => (s.key === "agent" ? { ...s, action: "remove" as const } : s)) },
};
check("removing an extension without deactivating → extension_not_deactivated", errCodes(notDeactivated).includes("extension_not_deactivated"));

// The extension deactivated but no restart acknowledged.
const noRestart: DeviceSetupRecording = {
  ...good,
  teardown: { verifyClean: true, steps: good.teardown!.steps.map((s) => (s.key === "agent" ? { key: s.key, label: s.label, action: "deactivate" as const } : s)) },
};
check("deactivating an extension without requiresRestart → extension_restart_unacknowledged", errCodes(noRestart).includes("extension_restart_unacknowledged"));

// The allow profile removed BEFORE the extension it authorized — stranding it.
const badOrder: DeviceSetupRecording = {
  ...good,
  teardown: {
    verifyClean: true,
    steps: [
      { key: "pppc", label: "Remove PPPC/TCC allow profile", action: "remove" },
      { key: "agent", label: "Deactivate + remove agent extension", action: "deactivate", requiresRestart: true },
      { key: "lockdown", label: "Remove kiosk restriction", action: "remove", sensitive: true },
      { key: "wifi", label: "Remove Wi-Fi config", action: "remove" },
    ],
  },
};
check("removing the allow profile before its extension → teardown_order_violation", errCodes(badOrder).includes("teardown_order_violation"));

// No clean-state verification.
const noVerify: DeviceSetupRecording = { ...good, teardown: { steps: good.teardown!.steps, verifyClean: false } };
check("no clean-state check → teardown_no_verify + not proven", errCodes(noVerify).includes("teardown_no_verify") && !teardownProven(noVerify));

// deployReady needs BOTH halves: a valid setup with a broken teardown is not ready.
check("valid setup + broken teardown is NOT deploy-ready", setupRecordingValid(good) && !deployReady(noVerify));

// ── fail-safe decommission planner ──────────────────────────────────────────────

const device = { serial: "CMAC-0001", model: "MacBook-Frontline", onNetwork: true };

// An unproven teardown is never executed.
const unprovenPlan = planTeardown(noVerify, device);
check("an unproven teardown is not executed (proven:false, no steps)", unprovenPlan.proven === false && unprovenPlan.steps.length === 0 && unprovenPlan.willRemoveAnything === false);

// Default is a simulated rehearsal — nothing removed for real.
const dry = planTeardown(good, device);
check("default plan is a simulated rehearsal (all held_simulated)", dry.mode === "simulated" && dry.steps.every((s) => s.disposition === "held_simulated") && dry.willRemoveAnything === false);
check("even a proven rehearsal includes the clean-state check", dry.verifiesClean === true);

// Enforced but enforcement OFF → still simulated (owner master switch).
const enforcedButOff = planTeardown(good, device, { mode: "enforced" });
check("enforced mode without the owner switch stays simulated", enforcedButOff.steps.every((s) => s.disposition === "held_simulated") && enforcedButOff.willRemoveAnything === false);

// Enforced + enabled → non-sensitive auto-removes, sensitive needs approval, order preserved.
const live = planTeardown(good, device, { mode: "enforced", enforcementEnabled: true });
check("enforced + enabled: the agent extension auto-removes (deactivate, restart-gated)", live.steps.find((s) => s.key === "agent")?.disposition === "auto_remove" && live.steps.find((s) => s.key === "agent")?.requiresRestart === true);
check("enforced + enabled: the sensitive lockdown removal requires approval", live.steps.find((s) => s.key === "lockdown")?.disposition === "approval_required" && live.requiresApproval === 1);
check("enforced plan preserves dependency order (agent before pppc)", live.steps.findIndex((s) => s.key === "agent") < live.steps.findIndex((s) => s.key === "pppc"));
check("enforced plan removes something and still verifies clean", live.willRemoveAnything === true && live.verifiesClean === true);

// Regression (review MAJOR): a non-matching device is NEVER touched, even under
// enforced mode with a proven teardown — same gate as planZeroTouchSetup.
const otherDevice = { serial: "XXXX-9999" };
const wrongDevice = planTeardown(good, otherDevice, { mode: "enforced", enforcementEnabled: true });
check("a non-matching device is never touched (matched:false, no removal)", wrongDevice.matched === false && wrongDevice.steps.length === 0 && wrongDevice.willRemoveAnything === false);

// Regression (review BLOCKER): a recording whose SETUP is invalid (a typo'd kind)
// but whose teardown looks 'proven' must NOT execute a real removal. Gating on
// deployReady (not teardownProven alone) is what closes the stranding hole.
const typoKind: DeviceSetupRecording = {
  id: "rec_typo",
  name: "Typo'd kind",
  match: { serialPrefix: "CMAC-" },
  triggers: ["first_boot"],
  // "appinstall" is NOT a valid SetupStepKind — setup is invalid, so NOT deploy-ready.
  steps: [{ key: "agent", label: "Install agent", kind: "appinstall" as never }],
  teardown: { verifyClean: true, steps: [{ key: "agent", label: "Remove agent", action: "remove" }] },
};
check("an invalid setup kind is not deploy-ready (setup invalid)", !setupRecordingValid(typoKind) && !deployReady(typoKind));
check("lintTeardown also flags the unknown reversed kind (defense-in-depth)", lintTeardown(typoKind).some((i) => i.code === "teardown_unknown_setup_kind"));
const typoPlan = planTeardown(typoKind, { serial: "CMAC-0002" }, { mode: "enforced", enforcementEnabled: true });
check("an invalid recording NEVER auto-removes (no stranded extension)", typoPlan.matched === false && typoPlan.willRemoveAnything === false && typoPlan.steps.length === 0);
// A PROTOTYPE-KEY kind ("toString") is the class `in` cannot see: `"toString" in
// TEARDOWN_ORDER` is true and the value is a function, so the unknown-kind guard stayed
// silent and `Math.max(prev, function)` poisoned the ordering guard with NaN for the rest
// of the plan — `lintTeardown` then reported NO order violation for a reversal that
// removes the allow profile before deactivating the extension it authorizes.
const maskedKind = {
  id: "rec_masked",
  name: "Masked kind",
  match: { serialPrefix: "CMAC-" },
  triggers: ["first_boot"],
  steps: [
    { key: "mask", label: "Masked", kind: "toString" as never },
    { key: "prof", label: "Allow profile", kind: "profile" as const },
    { key: "agent", label: "Install agent", kind: "app_install" as const },
  ],
  teardown: { verifyClean: true, steps: [
    { key: "mask", label: "Remove masked", action: "remove" as const },
    { key: "prof", label: "Remove profile", action: "remove" as const },
    { key: "agent", label: "Deactivate agent", action: "deactivate" as const, requiresRestart: true },
  ] },
};
const maskedIssues = lintTeardown(maskedKind as never);
check("SAFETY: a prototype-key setup kind is flagged as UNKNOWN by lintTeardown (own-key membership, not `in`)",
  maskedIssues.some((i) => i.code === "teardown_unknown_setup_kind"));
check("SAFETY: ...and it cannot poison the ordering guard — the profile-before-agent violation is still reported",
  maskedIssues.some((i) => i.code === "teardown_order_violation"));
check("SAFETY: a recording with a masked kind is not deploy-ready", !deployReady(maskedKind as never));

// Regression (review MINOR): a non-boolean requiresRestart is rejected (symmetric
// with sensitive) so a mistyped flag can't silently drop the restart hold.
const badRestart: DeviceSetupRecording = {
  ...good,
  teardown: { verifyClean: true, steps: good.teardown!.steps.map((s) => (s.key === "wifi" ? { ...s, requiresRestart: "true" as never } : s)) },
};
check("a non-boolean requiresRestart → invalid_teardown_restart_flag", errCodes(badRestart).includes("invalid_teardown_restart_flag"));

check("planner is deterministic", JSON.stringify(planTeardown(good, device)) === JSON.stringify(planTeardown(good, device)));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
