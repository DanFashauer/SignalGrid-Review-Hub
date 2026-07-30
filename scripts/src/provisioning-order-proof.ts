// Provisioning step-ORDER proof — OFFLINE and deterministic.
//
// Every vendor's zero-touch diagram is numbered, and the numbering is the part that
// matters: directory join before management enrollment, before policy, before apps.
// The recording model carried the steps but not the numbering — a setup that
// installed an app before establishing management linted CLEAN and failed on a real
// device at first boot, silently, by no-opping.
//
// Asserted, in order of how much each matters:
//   1. AN IMPOSSIBLE ORDER MAKES THE RECORDING INVALID, so the planner (which
//      refuses invalid recordings) can never carry it to a device.
//   2. THE RULE IS NARROW ENOUGH TO BE TRUE — it must not reject the legitimate
//      shapes: an add-on recording for already-managed devices, network/cert steps
//      first, and either order between the two management-establishing kinds.
//   3. ONE MODEL SPANS FOUR VENDORS — Autopilot, Apple ADE, Android Zero-Touch and
//      Jamf PreStage all express and all validate.

import {
  lintSetupOrder,
  lintSetupRecording,
  planZeroTouchSetup,
  setupRecordingValid,
  MANAGEMENT_DEPENDENT_KINDS,
  MANAGEMENT_ESTABLISHING_KINDS,
  VENDOR_REFERENCE_PIPELINES,
  type DeviceSetupRecording,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
const codes = (r: DeviceSetupRecording, sev: "error" | "warning"): string[] =>
  lintSetupRecording(r).filter((i) => i.severity === sev).map((i) => i.code);

console.log("Provisioning step-order proof — the numbering on the diagram is load-bearing\n");

const base = {
  id: "rec_test",
  name: "Test",
  match: { serialPrefix: "T-" },
  triggers: ["first_boot"] as const,
};

// ── 1. An impossible order is an ERROR and blocks the apply ──────────────────
{
  // The exact defect: the app lands before the device is managed. This is what
  // linted clean before, and what silently no-ops on real hardware.
  const appBeforeManagement: DeviceSetupRecording = {
    ...base,
    triggers: ["first_boot"],
    steps: [
      { key: "emr", label: "Deploy EMR app", kind: "app_install" },
      { key: "mdm", label: "Install MDM profile", kind: "profile" },
    ],
  };
  check("an app_install BEFORE management is an error",
    codes(appBeforeManagement, "error").includes("step_before_management"));
  check("...so the recording is INVALID",
    setupRecordingValid(appBeforeManagement) === false);
  // The point of routing this through validity rather than a separate opt-in check.
  check("...and the planner refuses to carry it to a device, even fully enforced",
    (() => {
      const plan = planZeroTouchSetup(appBeforeManagement, { serial: "T-1" },
        { mode: "enforced", enforcementEnabled: true });
      return plan.willApplyAnything === false && plan.steps.length === 0;
    })());

  check("a policy before management is an error too",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "pol", label: "Baseline", kind: "policy" },
      { key: "mdm", label: "MDM", kind: "profile" },
    ] }, "error").includes("step_before_management"));
  check("a restriction before management is an error too",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "kiosk", label: "Kiosk", kind: "restriction" },
      { key: "mdm", label: "MDM", kind: "profile" },
    ] }, "error").includes("step_before_management"));
  // The error must name BOTH ends, or an operator has to go find the other one.
  check("the message names the offending step AND the management step it precedes",
    (() => {
      const m = lintSetupRecording(appBeforeManagement)
        .find((i) => i.code === "step_before_management")?.message ?? "";
      return m.includes("emr") && m.includes("mdm");
    })());
}

// ── 2. Explicit prerequisites ────────────────────────────────────────────────
{
  const requiresLater: DeviceSetupRecording = {
    ...base, triggers: ["first_boot"],
    steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install", requires: ["vpn"] },
      { key: "vpn", label: "VPN profile", kind: "profile" },
    ],
  };
  check("a prerequisite that runs LATER is an error (the array is the execution order)",
    codes(requiresLater, "error").includes("requires_later_step"));
  check("...and the message gives both positions, so the fix is mechanical",
    (lintSetupRecording(requiresLater).find((i) => i.code === "requires_later_step")?.message ?? "")
      .includes("position"));
  check("a prerequisite naming a step that does not exist is an error",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install", requires: ["ghost"] },
    ] }, "error").includes("unknown_requires"));
  // Reported as self_requires and NOT as requires_later_step. Pinning WHICH code
  // fires matters: the self-check returns first, which is why the `depAt >= i`
  // comparison's equality case is unreachable. A control that flipped `>=` to `>`
  // changed nothing, and this assertion is what explains that rather than leaving
  // it looking like an untested branch.
  check("a step that requires ITSELF is self_requires, not a forward-reference error",
    (() => {
      const c = codes({ ...base, triggers: ["first_boot"], steps: [
        { key: "mdm", label: "MDM", kind: "profile" },
        { key: "app", label: "App", kind: "app_install", requires: ["app"] },
      ] }, "error");
      return c.includes("self_requires") && !c.includes("requires_later_step");
    })());
  // Untyped JSON: a non-array `requires` must not be silently dropped, because
  // dropping it removes a declared dependency and lets the step run early.
  check("a non-array requires is an error, never silently ignored",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install", requires: "mdm" as never },
    ] }, "error").includes("invalid_requires"));
  check("a requires entry that is not a non-empty string is an error",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install", requires: ["" ] },
    ] }, "error").includes("invalid_requires"));
  // A CYCLE is unrepresentable — every edge must point strictly earlier — so it
  // surfaces as a forward reference rather than needing its own detector.
  check("a cycle surfaces as a forward reference (no unreachable cycle detector needed)",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "a", label: "A", kind: "app_install", requires: ["b"] },
      { key: "b", label: "B", kind: "app_install", requires: ["a"] },
    ] }, "error").includes("requires_later_step"));
  // Non-vacuity: a correctly-ordered prerequisite must still pass.
  check("a prerequisite that runs EARLIER is clean",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "vpn", label: "VPN", kind: "profile", requires: ["mdm"] },
      { key: "app", label: "App", kind: "app_install", requires: ["vpn", "mdm"] },
    ] }, "error").length === 0);
}

// ── 3. The rule must be NARROW enough to be true ─────────────────────────────
//
// A rule that rejects legitimate recordings is worse than no rule: it gets
// switched off, and it takes the real finding with it. These pin the shapes that
// MUST keep working.
{
  // An add-on recording for an already-enrolled fleet establishes no management of
  // its own. Legitimate — warned, never blocked.
  const addOn: DeviceSetupRecording = {
    ...base, triggers: ["first_boot"],
    steps: [{ key: "app", label: "Add an app", kind: "app_install" }],
  };
  check("an add-on recording for already-managed devices is VALID (warned, not blocked)",
    setupRecordingValid(addOn) && codes(addOn, "warning").includes("assumes_existing_management"));
  check("...and the warning is not raised when the recording has no dependent steps",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "wifi", label: "Wi-Fi", kind: "wifi" },
    ] }, "warning").includes("assumes_existing_management") === false);

  // Network and identity legitimately come FIRST — they are how the device reaches
  // the management plane at all. A rule that forced them later would be wrong in
  // exactly the deployments that need them most.
  check("wifi and cert BEFORE management are fine — that is how the device gets there",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "wifi", label: "Wi-Fi", kind: "wifi" },
      { key: "cert", label: "Identity cert", kind: "cert" },
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install" },
    ] }, "error").length === 0);

  // EITHER management kind may come first — Autopilot joins the directory then
  // enrols; Apple installs the enrollment profile then binds the account. Pinning
  // one order would encode a single vendor as universal law.
  check("profile-then-account is accepted",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "acct", label: "Account", kind: "account" },
      { key: "app", label: "App", kind: "app_install" },
    ] }, "error").length === 0);
  check("account-then-profile is ALSO accepted — neither vendor's order is law",
    codes({ ...base, triggers: ["first_boot"], steps: [
      { key: "acct", label: "Account", kind: "account" },
      { key: "mdm", label: "MDM", kind: "profile" },
      { key: "app", label: "App", kind: "app_install" },
    ] }, "error").length === 0);
  // THE ASSERTION ABOVE DOES NOT ACTUALLY TEST THAT `account` ESTABLISHES
  // MANAGEMENT, and a negative control proved it: dropping "account" from
  // MANAGEMENT_ESTABLISHING_KINDS left it green, because the `profile` on the very
  // next line still precedes the app. The claim needs a recording where `account`
  // is the ONLY management step — then removing it flips this to the
  // assumes_existing_management warning, which is observable.
  check("an `account` step ALONE establishes management — no 'assumes existing' warning",
    (() => {
      const acctOnly: DeviceSetupRecording = { ...base, triggers: ["first_boot"], steps: [
        { key: "acct", label: "Directory join", kind: "account" },
        { key: "app", label: "App", kind: "app_install" },
      ] };
      return lintSetupRecording(acctOnly).length === 0;
    })());
  check("...and a `profile` step alone does too, symmetrically",
    (() => {
      const profOnly: DeviceSetupRecording = { ...base, triggers: ["first_boot"], steps: [
        { key: "mdm", label: "MDM", kind: "profile" },
        { key: "app", label: "App", kind: "app_install" },
      ] };
      return lintSetupRecording(profOnly).length === 0;
    })());
  check("the two kind lists are disjoint — no kind both needs and provides management",
    MANAGEMENT_DEPENDENT_KINDS.every((k) => !MANAGEMENT_ESTABLISHING_KINDS.includes(k)));

  // The pre-existing repo recordings were already correctly ordered. This change
  // must not have invalidated them — it enforces what authors were already doing.
  check("the shipped clinical-tablet shape (wifi → profile → app → restriction) stays valid",
    setupRecordingValid({ ...base, triggers: ["first_boot"], steps: [
      { key: "wifi", label: "Join clinical Wi-Fi", kind: "wifi" },
      { key: "profile", label: "Install MDM profile", kind: "profile" },
      { key: "emr", label: "Deploy EMR app", kind: "app_install" },
      { key: "lockdown", label: "Apply kiosk restriction", kind: "restriction", sensitive: true },
    ] }));
}

// ── 4. One model, four vendors ───────────────────────────────────────────────
//
// "It works no matter which solution you use" is an aspiration until something
// demonstrates the neutral model actually spans them.
{
  check(`four vendor reference pipelines are shipped (${VENDOR_REFERENCE_PIPELINES.length})`,
    VENDOR_REFERENCE_PIPELINES.length === 4);
  for (const p of VENDOR_REFERENCE_PIPELINES) {
    check(`${p.name}: expresses in the neutral model and validates clean`,
      setupRecordingValid(p) && lintSetupOrder(p).every((i) => i.severity !== "error"));
  }
  // Each really exercises the ordering rule rather than trivially passing by having
  // no dependent steps at all.
  check("...and each one actually contains management-dependent steps (not a vacuous pass)",
    VENDOR_REFERENCE_PIPELINES.every((p) =>
      p.steps.some((s) => MANAGEMENT_DEPENDENT_KINDS.includes(s.kind))));
  check("...and each declares explicit prerequisites, so the requires path is exercised",
    VENDOR_REFERENCE_PIPELINES.every((p) => p.steps.some((s) => (s.requires?.length ?? 0) > 0)));
  // The vendors disagree about which management kind comes first. If they all
  // happened to agree, the "neither order is law" assertion above would be untested
  // by real data.
  check("the four pipelines are NOT all identical in shape — the model spans real variation",
    new Set(VENDOR_REFERENCE_PIPELINES.map((p) => p.steps.map((s) => s.kind).join(">"))).size > 1);

  // NEGATIVE CONTROL ON THE FIXTURES THEMSELVES: shuffling any vendor pipeline so
  // its apps precede its management must break it. Without this, "all four
  // validate" could mean the checker accepts anything.
  const broken = VENDOR_REFERENCE_PIPELINES.map((p) => {
    const dependent = p.steps.filter((s) => MANAGEMENT_DEPENDENT_KINDS.includes(s.kind));
    const rest = p.steps.filter((s) => !MANAGEMENT_DEPENDENT_KINDS.includes(s.kind));
    // Drop `requires` so the ONLY remaining defect is the management ordering —
    // otherwise a forward-reference error would mask what is being tested.
    return { ...p, steps: [...dependent, ...rest].map(({ requires: _r, ...s }) => s) };
  });
  check("...and moving the dependent steps first breaks EVERY one of them",
    broken.every((p) => codes(p, "error").includes("step_before_management")));
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
