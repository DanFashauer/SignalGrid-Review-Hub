// Proof: the Trust→Action orchestration layer (@workspace/orchestration).
//
// Asserts the safety-critical invariants of the Assist model:
//   • sensitive actions are NEVER auto on an allow — always assist (human-confirm)
//   • deny blocks everything; restrict blocks access but permits ambient prep;
//     step-up holds gated actions; allow auto-runs only non-sensitive actions
//   • confirming assist actions moves them to applied; confirming all → proceed
//   • deterministic: same input → identical plan (stable action ids)
//
// Run: pnpm --filter @workspace/scripts run proof:orchestration

import { planOrchestration, confirmActions, completeStepUp, type RoomContext } from "@workspace/orchestration";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const room = (sensitivity: RoomContext["sensitivity"], workflowKey: string): RoomContext => ({
  roomId: "RM-1", unit: "Test", sensitivity, workflowKey, workflowLabel: "Test workflow",
});

const standard = room("standard", "general-lookup");
const controlled = room("controlled", "med-admin");

// ── allow, standard room ────────────────────────────────────────────────────
const allowStd = planOrchestration({ outcome: "allow", reasonCodes: [], room: standard });
check("allow/standard mode is assist (PHI display is sensitive)", allowStd.mode === "assist");
check("allow/standard: the clinical display is assist, not auto",
  allowStd.actions.find((a) => a.kind === "clinical.display.activate")?.disposition === "assist");
check("allow/standard: non-sensitive lighting is auto",
  allowStd.actions.find((a) => a.kind === "environment.lighting")?.disposition === "auto");
check("SAFETY: no sensitive action is ever auto on allow",
  allowStd.actions.every((a) => !(a.sensitive && a.disposition === "auto")));

// ── allow, controlled room: door + device + display all sensitive ───────────
const allowCtl = planOrchestration({ outcome: "allow", reasonCodes: [], room: controlled });
const ctlAssist = allowCtl.actions.filter((a) => a.disposition === "assist").map((a) => a.kind).sort();
check("allow/controlled: door, device, and display are all assist",
  ctlAssist.includes("door.unlock") && ctlAssist.includes("device.assign") && ctlAssist.includes("clinical.display.activate"));
check("allow/controlled: every assist requires confirmation",
  allowCtl.actions.filter((a) => a.disposition === "assist").every((a) => a.requiresConfirmation));

// ── deny blocks everything ──────────────────────────────────────────────────
const deny = planOrchestration({ outcome: "deny", reasonCodes: ["IDENTITY_DISABLED"], room: controlled });
check("deny mode is deny", deny.mode === "deny");
check("deny blocks every action", deny.actions.every((a) => a.disposition === "blocked"));
check("deny surfaces the reason code", deny.actions[0].reason.includes("IDENTITY_DISABLED"));

// ── restrict: access blocked, ambient permitted ─────────────────────────────
const restrict = planOrchestration({ outcome: "restrict", reasonCodes: ["DEVICE_NONCOMPLIANT"], room: controlled });
check("restrict mode is hold", restrict.mode === "hold");
check("restrict blocks the door", restrict.actions.find((a) => a.kind === "door.unlock")?.disposition === "blocked");
check("restrict still permits ambient lighting (auto)",
  restrict.actions.find((a) => a.kind === "environment.lighting")?.disposition === "auto");

// ── step-up: gated actions held, ambient auto ───────────────────────────────
const stepUp = planOrchestration({ outcome: "step_up", reasonCodes: ["BASELINE_DRIFTED"], room: controlled });
check("step_up mode is step_up", stepUp.mode === "step_up");
check("step_up holds the mobile session", stepUp.actions.find((a) => a.kind === "mobile.session.start")?.disposition === "step_up");
check("step_up permits ambient alert routing (auto)",
  stepUp.actions.find((a) => a.kind === "alert.route")?.disposition === "auto");

// ── confirm flow ────────────────────────────────────────────────────────────
const input = { outcome: "allow" as const, reasonCodes: [], room: controlled };
const sensitiveIds = planOrchestration(input).actions.filter((a) => a.disposition === "assist").map((a) => a.id);
const partial = confirmActions(input, [sensitiveIds[0]]);
check("confirming one assist applies it", partial.actions.find((a) => a.id === sensitiveIds[0])?.disposition === "applied");
check("confirming one of several leaves mode assist", partial.mode === "assist");
const full = confirmActions(input, sensitiveIds);
check("confirming all sensitive actions → mode proceed", full.mode === "proceed");
check("confirming all → no assist actions remain", full.actions.every((a) => a.disposition !== "assist"));

// ── step-up completion releases held actions ────────────────────────────────
const suInput = { outcome: "step_up" as const, reasonCodes: ["BASELINE_DRIFTED"], room: controlled };
check("step_up before completion holds gated actions", planOrchestration(suInput).mode === "step_up");
const suDone = completeStepUp(suInput);
check("completeStepUp releases held actions (controlled → mode assist)", suDone.mode === "assist");
check("completeStepUp: a non-sensitive gated action becomes auto",
  suDone.actions.find((a) => a.kind === "mobile.session.start")?.disposition === "auto");
check("completeStepUp: sensitive actions still require human confirmation",
  suDone.actions.filter((a) => a.sensitive).every((a) => a.disposition === "assist"));
check("SAFETY: step-up completion never auto-runs a sensitive action",
  suDone.actions.every((a) => !(a.sensitive && a.disposition === "auto")));

// ── controlled-room extras ──────────────────────────────────────────────────
const ctlKinds = planOrchestration({ outcome: "allow", reasonCodes: [], room: controlled }).actions.map((a) => a.kind);
check("controlled room includes medication cabinet + witness",
  ctlKinds.includes("medication.cabinet.unlock") && ctlKinds.includes("witness.require"));
check("standard room excludes controlled-only extras",
  !planOrchestration({ outcome: "allow", reasonCodes: [], room: standard }).actions.some((a) => a.kind === "medication.cabinet.unlock"));

// ── warehouse domain: same Assist model, warehouse catalog + language ────────
const whZone = (sensitivity: RoomContext["sensitivity"], workflowKey: string): RoomContext => ({
  roomId: "AISLE-1", unit: "DC-7", sensitivity, workflowKey, workflowLabel: "Warehouse workflow", domain: "warehouse",
});
const whStd = whZone("standard", "pick-pack");
const whCtl = whZone("controlled", "controlled-area");

const whAllow = planOrchestration({ outcome: "allow", reasonCodes: [], room: whCtl });
const whKinds = whAllow.actions.map((a) => a.kind);
check("warehouse catalog: gate/handheld/manifest present, no clinical kinds",
  whKinds.includes("gate.unlock") && whKinds.includes("handheld.session.start") && whKinds.includes("manifest.display.activate") &&
  !whKinds.includes("door.unlock") && !whKinds.includes("clinical.display.activate"));
check("warehouse controlled area adds cage + supervisor witness",
  whKinds.includes("cage.unlock") && whKinds.includes("witness.require"));
check("warehouse standard zone excludes controlled-only extras",
  !planOrchestration({ outcome: "allow", reasonCodes: [], room: whStd }).actions.some((a) => a.kind === "cage.unlock"));
check("warehouse manifest display is always sensitive (customer PII), never auto",
  whAllow.actions.every((a) => !(a.sensitive && a.disposition === "auto")) &&
  whAllow.actions.find((a) => a.kind === "manifest.display.activate")?.disposition === "assist");
check("warehouse confirmation language names the supervisor, not a clinician",
  whAllow.summary.includes("supervisor") && !whAllow.summary.includes("clinician") &&
  (whAllow.actions.find((a) => a.disposition === "assist")?.reason.includes("supervisor") ?? false));
check("warehouse deny blocks every action too",
  planOrchestration({ outcome: "deny", reasonCodes: ["IDENTITY_DISABLED"], room: whCtl }).actions.every((a) => a.disposition === "blocked"));
check("warehouse step-up holds the gate, permits ambient lighting",
  (() => { const p = planOrchestration({ outcome: "step_up", reasonCodes: ["BASELINE_DRIFTED"], room: whCtl });
    return p.actions.find((a) => a.kind === "gate.unlock")?.disposition === "step_up" &&
      p.actions.find((a) => a.kind === "environment.lighting")?.disposition === "auto"; })());
check("clinical domain is unchanged (default): summary still names the clinician",
  planOrchestration({ outcome: "allow", reasonCodes: [], room: controlled }).summary.includes("clinician"));

// ── global-fleet domain: fleet catalog + dispatcher language ──────────────────
const gfZone = (sensitivity: RoomContext["sensitivity"], workflowKey: string): RoomContext => ({
  roomId: "VEH-1", unit: "EU-West", sensitivity, workflowKey, workflowLabel: "Fleet workflow", domain: "global_fleet",
});
const gfAllow = planOrchestration({ outcome: "allow", reasonCodes: [], room: gfZone("controlled", "vehicle-checkout") });
const gfKinds = gfAllow.actions.map((a) => a.kind);
check("fleet catalog: vehicle/mount/manifest present, no clinical/warehouse kinds",
  gfKinds.includes("vehicle.unlock") && gfKinds.includes("mount.session.start") && gfKinds.includes("manifest.display.activate") &&
  !gfKinds.includes("door.unlock") && !gfKinds.includes("gate.unlock"));
check("fleet controlled checkout adds cargo seal + dispatcher co-sign",
  gfKinds.includes("cargo.seal.release") && gfKinds.includes("witness.require"));
check("fleet standard zone excludes controlled-only extras",
  !planOrchestration({ outcome: "allow", reasonCodes: [], room: gfZone("standard", "field-session") }).actions.some((a) => a.kind === "cargo.seal.release"));
check("fleet manifest display is always sensitive (regulated cargo/PII), never auto",
  gfAllow.actions.every((a) => !(a.sensitive && a.disposition === "auto")) &&
  gfAllow.actions.find((a) => a.kind === "manifest.display.activate")?.disposition === "assist");
check("fleet confirmation language names the dispatcher",
  gfAllow.summary.includes("dispatcher") &&
  (gfAllow.actions.find((a) => a.disposition === "assist")?.reason.includes("dispatcher") ?? false));

// ── determinism ─────────────────────────────────────────────────────────────
const a = JSON.stringify(planOrchestration({ outcome: "allow", reasonCodes: [], room: controlled }));
const b = JSON.stringify(planOrchestration({ outcome: "allow", reasonCodes: [], room: controlled }));
check("plans are deterministic (identical for identical input)", a === b);

const total = passed + failures.length;
console.log(`Orchestration proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Trust→Action orchestration verified (Assist model + human-in-the-loop safety).");
