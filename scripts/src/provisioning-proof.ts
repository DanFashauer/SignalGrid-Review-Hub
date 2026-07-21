// Proof: zero-touch provisioning (@workspace/flows) — record → validate → apply.
//
// Verifies the deterministic core behind the Designer / Device Action Recorder:
// a recorded device setup validates like config, and the apply planner is
// fail-safe — a non-matching device is never touched, an invalid recording is
// never applied, nothing actually runs unless an owner turned enforcement on AND
// asked for enforced mode, and even then a sensitive step needs approval. An
// empty device selector never matches everything.
//
// Run: pnpm --filter @workspace/scripts run proof:provisioning

import {
  lintSetupRecording,
  planZeroTouchSetup,
  setupRecordingValid,
  type DeviceSetupRecording,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
const errCodes = (r: DeviceSetupRecording): string[] => lintSetupRecording(r).filter((i) => i.severity === "error").map((i) => i.code);
const warnCodes = (r: DeviceSetupRecording): string[] => lintSetupRecording(r).filter((i) => i.severity === "warning").map((i) => i.code);

console.log("Zero-touch provisioning proof");

// A clean, valid recording (a shared clinical tablet first-boot setup).
const good: DeviceSetupRecording = {
  id: "rec_clinical_tablet",
  name: "Clinical tablet first-boot",
  match: { serialPrefix: "CLIN-", model: "MediPad-X" },
  triggers: ["first_boot", "network_join"],
  steps: [
    { key: "wifi", label: "Join clinical Wi-Fi", kind: "wifi" },
    { key: "profile", label: "Install MDM profile", kind: "profile" },
    { key: "emr", label: "Deploy EMR app", kind: "app_install" },
    { key: "lockdown", label: "Apply kiosk restriction", kind: "restriction", sensitive: true },
  ],
};
check("a clean recording has zero errors", errCodes(good).length === 0);
check("a sensitive step is a warning (not an error)", warnCodes(good).includes("sensitive_step") && setupRecordingValid(good));

// ── lint rules each fire ──────────────────────────────────────────────────────
const clone = (): DeviceSetupRecording => JSON.parse(JSON.stringify(good)) as DeviceSetupRecording;
const noSteps = clone(); noSteps.steps = [];
check("a recording with no steps is invalid", errCodes(noSteps).includes("no_steps") && !setupRecordingValid(noSteps));
const noTrig = clone(); noTrig.triggers = [];
check("a recording with no triggers is invalid", errCodes(noTrig).includes("no_trigger") && !setupRecordingValid(noTrig));
const badTrig = clone(); (badTrig.triggers as string[]) = ["whenever"];
check("an unrecognized trigger is invalid", errCodes(badTrig).includes("invalid_trigger"));
const noSel = clone(); noSel.match = {};
check("no device selector is invalid (never match-everything)", errCodes(noSel).includes("no_device_selector") && !setupRecordingValid(noSel));
const badKind = clone(); (badKind.steps[0] as { kind: string }).kind = "reboot-the-universe";
check("an unrecognized step kind is invalid", errCodes(badKind).includes("invalid_step_kind"));
const dupKey = clone(); dupKey.steps.push({ ...dupKey.steps[0] });
check("a duplicate step key is invalid", errCodes(dupKey).includes("duplicate_step_key"));
const noId = clone(); noId.id = "";
check("a missing recording id is invalid", errCodes(noId).includes("missing_id"));
check("errors are ordered before warnings", (() => { const sev = lintSetupRecording(good).map((i) => i.severity); const fw = sev.indexOf("warning"); return fw === -1 || !sev.slice(fw).includes("error"); })());

// ── apply planner: fail-safe ────────────────────────────────────────────────────
const clinDevice = { serial: "CLIN-00042", model: "MediPad-X", onNetwork: true };
const otherDevice = { serial: "WARE-00042", model: "Handheld", onNetwork: true };

// A non-matching device is never touched.
const noMatch = planZeroTouchSetup(good, otherDevice);
check("a non-matching device is never touched", noMatch.matched === false && noMatch.steps.length === 0 && noMatch.willApplyAnything === false);

// An invalid recording is never applied, even to a matching device.
const invalidApplied = planZeroTouchSetup(noSteps, clinDevice, { mode: "enforced", enforcementEnabled: true });
check("an invalid recording is never applied", invalidApplied.matched === false && invalidApplied.willApplyAnything === false);

// Default = simulated: matched, but nothing runs.
const sim = planZeroTouchSetup(good, clinDevice);
check("default mode is simulated — matched but nothing applies", sim.matched === true && sim.mode === "simulated" && sim.steps.every((s) => s.disposition === "held_simulated") && sim.willApplyAnything === false);

// Enforced mode WITHOUT the owner switch still simulates (the switch is the gate).
const enforcedNoSwitch = planZeroTouchSetup(good, clinDevice, { mode: "enforced", enforcementEnabled: false });
check("enforced mode without the owner switch still simulates (nothing runs)", enforcedNoSwitch.steps.every((s) => s.disposition === "held_simulated") && enforcedNoSwitch.willApplyAnything === false);

// Enforced + owner-enabled: non-sensitive auto-applies, sensitive needs approval.
const enforced = planZeroTouchSetup(good, clinDevice, { mode: "enforced", enforcementEnabled: true });
check("under real enforcement a sensitive step requires approval (never auto)", enforced.steps.find((s) => s.key === "lockdown")?.disposition === "approval_required");
check("under real enforcement non-sensitive steps auto-apply", enforced.steps.find((s) => s.key === "wifi")?.disposition === "auto_apply" && enforced.willApplyAnything === true);
check("the sensitive step is counted in requiresApproval", enforced.requiresApproval === 1);

// Global fail-safe: a sensitive step is NEVER auto_apply, in any mode.
const modes: Array<{ mode: "simulated" | "enforced"; enforcementEnabled: boolean }> = [
  { mode: "simulated", enforcementEnabled: false }, { mode: "simulated", enforcementEnabled: true },
  { mode: "enforced", enforcementEnabled: false }, { mode: "enforced", enforcementEnabled: true },
];
const sensitiveNeverAuto = modes.every((o) => planZeroTouchSetup(good, clinDevice, o).steps.filter((s) => s.key === "lockdown").every((s) => s.disposition !== "auto_apply"));
check("a sensitive step is NEVER auto-applied, in any mode", sensitiveNeverAuto);

// Selector matching: serial prefix + model both enforced.
const wrongModel = planZeroTouchSetup(good, { serial: "CLIN-1", model: "Other" });
check("a serial-prefix match with the wrong model does not match", wrongModel.matched === false);
const serialOnly: DeviceSetupRecording = { ...good, match: { serialPrefix: "CLIN-" } };
check("a serial-prefix-only recording matches on prefix", planZeroTouchSetup(serialOnly, { serial: "CLIN-9" }).matched === true);
check("a serial-prefix-only recording rejects a non-prefixed serial", planZeroTouchSetup(serialOnly, { serial: "WARE-9" }).matched === false);

// ── untyped-boundary fail-safety (=== true vs truthy) ──────────────────────────
// The owner switch must be STRICTLY true — a truthy-not-true value still simulates.
const truthySwitch = planZeroTouchSetup(good, clinDevice, { mode: "enforced", enforcementEnabled: "true" as unknown as boolean });
check("enforcementEnabled truthy-not-true still simulates (nothing runs)", truthySwitch.willApplyAnything === false && truthySwitch.steps.every((s) => s.disposition === "held_simulated"));
// An unrecognized mode (wrong case) falls back to simulated.
const wrongCaseMode = planZeroTouchSetup(good, clinDevice, { mode: "ENFORCED" as unknown as "enforced", enforcementEnabled: true });
check("an unrecognized mode falls back to simulated", wrongCaseMode.mode === "simulated" && wrongCaseMode.willApplyAnything === false);

// A non-boolean `sensitive` (from JSON) is invalid — so it can never auto-apply.
const strSensitive = clone(); (strSensitive.steps[3] as { sensitive: unknown }).sensitive = "true";
check("a non-boolean sensitive value is an error", errCodes(strSensitive).includes("invalid_sensitive_flag") && !setupRecordingValid(strSensitive));
check("a recording with a mistyped sensitive flag is never applied", planZeroTouchSetup(strSensitive, clinDevice, { mode: "enforced", enforcementEnabled: true }).willApplyAnything === false);

// The validity gate blocks apply for an invalid-but-has-steps recording, not just
// the empty-steps case — a matching device under enforcement still applies nothing.
const invalidHasSteps = clone(); (invalidHasSteps.triggers as string[]) = ["whenever"]; // invalid_trigger, steps intact
check("an invalid-but-populated recording is never applied", !setupRecordingValid(invalidHasSteps) && planZeroTouchSetup(invalidHasSteps, clinDevice, { mode: "enforced", enforcementEnabled: true }).matched === false);

// Determinism.
const a = planZeroTouchSetup(good, clinDevice, { mode: "enforced", enforcementEnabled: true });
const b = planZeroTouchSetup(good, clinDevice, { mode: "enforced", enforcementEnabled: true });
check("planning is deterministic", JSON.stringify(a) === JSON.stringify(b));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
