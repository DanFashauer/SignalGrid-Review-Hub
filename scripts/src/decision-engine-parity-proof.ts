// Decision-engine parity proof — the shared vector table the Swift port replays.
//
// WHAT THIS PINS. `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is a
// byte-faithful port of `lib/signalgrid-simulator/src/decisionEngine.ts` (CLAUDE.md
// golden rule 1). Until 2026-09-26 the only gate on that claim was
// `scripts/check-decision-port-parity.mjs`, which compares VOCABULARY — reason codes
// and outcome literals present in both files. Vocabulary cannot see a rule whose words
// match and whose logic does not. This proof runs the TypeScript engine over a
// deterministic table of signal sets and emits what it DECIDED to
// `native/shared/decision-engine-vectors.json`, in the same shape as
// `native/shared/remediation-allow-vectors.json`; the Swift twin
// (`native/ios/EnterpriseShellTests/DecisionEngineParityTests.swift`) reads that file by
// path, replays every case through `DecisionEngine.evaluate`, and asserts the ordered
// outcome set and the reason codes are identical. That is behavioural parity, and
// `.github/workflows/ios-ci.yml` runs the Swift side on both build systems whenever the
// TS engine or the vectors change.
//
//   pnpm run proof:decision-engine-parity            check the committed vectors
//   pnpm run proof:decision-engine-parity -- --emit  rewrite them from the engine
//
// THE CASES. (a) Every simulator scenario's starting signals, normalized exactly as
// `runScenario` normalizes them. (b) A synthetic sweep from TRIGGERS below — every signal
// type and attribute literal the engine's predicates read — each ALONE (empty context)
// and each ON TOP OF base trust (authenticated + fresh posture), so the
// ALLOW_REMOVED_* strips are pinned as well as the raw rules; the unauthorized-removal
// pair (an undock with and without an active session); one representative of every
// trigger family paired with every other on base trust, so precedence and ordering are
// pinned, not assumed; and the three base-trust shapes (identity + posture, identity +
// Apple declared state, nothing at all).
//
// THE SHARED DOMAIN. Attribute values are STRINGIFIED (`true` → "true", 42 → "42")
// because the port's `Signal.attributes` is `[String: String]` and the engine's
// `=== true` becomes `== "true"` there. A `null` attribute is omitted: no predicate on
// either side reads one, and the port cannot hold it. A TS STRING "true"/"false" is
// OUTSIDE the shared domain — the engine's `=== true` does not fire on it while the
// port's `== "true"` would, and after stringification the two inputs are the same
// bytes — so no case may carry one (gated below). That is a property of the port's
// input type, stated here, not a drift.
//
// WHAT IS GATED: the table clears its floors; EVERY reason code the engine's source can
// push appears in at least one case (the set is read from the source, so a rule added
// tomorrow without a case is red here); building the table twice yields the same bytes;
// and the committed file is byte-identical to the table (re-emit on a red). Nothing here
// modifies either ported file, and nothing here reads a clock.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSimulatorScenarios,
  runScenario,
  type DecisionOutcome,
  type SignalGridEventType,
  type SignalGridLayer,
  type SignalGridSignal,
  type SimulatorScenario,
} from "@workspace/signalgrid-simulator";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VECTOR_PATH = "native/shared/decision-engine-vectors.json";
const ENGINE_PATH = "lib/signalgrid-simulator/src/decisionEngine.ts";
const EMIT = process.argv.slice(2).includes("--emit");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

// ── vector shapes ────────────────────────────────────────────────────────────
interface VectorSignal {
  type: string;
  layer: string;
  attributes: Record<string, string>;
}
interface VectorCase {
  id: string;
  group: "scenario" | "base" | "single" | "single-on-base" | "removal" | "pair";
  signals: VectorSignal[];
  expectOutcomes: DecisionOutcome[];
  expectReasonCodes: string[];
  expectPrimaryOutcome: DecisionOutcome;
}

// The fixture clock the scenarios themselves use — a constant, never Date.now().
const OBSERVED_AT = "2026-06-09T14:00:00.000Z";

type Attrs = Record<string, string | number | boolean | null>;

// Every TS-side string "true"/"false" seen while building the table — the shared-domain
// guard above reads this after the build (a scenario fixture could carry one too).
const stringBooleanViolations: string[] = [];
const stringifyAttributes = (attributes: Attrs): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(attributes).sort()) {
    const value = attributes[key];
    if (value === null || value === undefined) continue;
    if (value === "true" || value === "false") stringBooleanViolations.push(`${key}=${value}`);
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
};

const toVectorSignal = (signal: SignalGridSignal): VectorSignal => ({
  type: signal.type,
  layer: signal.layer,
  attributes: stringifyAttributes(signal.attributes),
});

const sig = (type: SignalGridEventType, layer: SignalGridLayer, attributes: Attrs = {}): SignalGridSignal => ({
  id: `vec:${type}:${Object.entries(attributes).map(([k, v]) => `${k}=${String(v)}`).join(",") || "-"}`,
  type,
  layer,
  source: "parity fixture",
  subject: "device:parity-001",
  observedAt: OBSERVED_AT,
  severity: "info",
  summary: `parity vector signal ${type}`,
  attributes,
});

/** A synthetic scenario around a signal set: only `startingSignals` reaches the engine. */
const scenarioOf = (id: string, signals: SignalGridSignal[]): SimulatorScenario => ({
  id: `parity:${id}`,
  title: `parity vector ${id}`,
  summary: "Synthetic decision-engine parity vector; the engine's own decision is the expectation.",
  persona: "parity harness",
  startingSignals: signals,
  expectedOutcomes: [],
  expectedOwnerTeam: "parity harness",
  safeDemoNote: "Synthetic signals only. No real system is consulted.",
});

// ── the trigger table — every literal the engine's predicates read ───────────
// Carrier types for attribute-only triggers are ones the engine never tests BY TYPE, so
// the attribute is the only thing that can fire. `identity` is a LAYER, tested by the
// identity-integrity predicate alongside the attribute, hence the explicit layer.
interface Trigger {
  family: string;
  label: string;
  signal: SignalGridSignal;
}
const T = (family: string, label: string, type: SignalGridEventType, layer: SignalGridLayer, attributes: Attrs = {}): Trigger => ({
  family,
  label,
  signal: sig(type, layer, attributes),
});
const CARRIER: SignalGridEventType = "device.configuration_observed";
const TRIGGERS: Trigger[] = [
  // identity integrity (layer-gated) + security risk (any layer)
  T("identity", "type:identity.risk_detected", "identity.risk_detected", "identity", { risk: "high" }),
  T("identity", "attr:identityState=invalid", CARRIER, "identity", { identityState: "invalid" }),
  T("identity", "attr:identityState=disabled", CARRIER, "identity", { identityState: "disabled" }),
  T("identity", "attr:risk=high(identity layer)", CARRIER, "identity", { risk: "high" }),
  T("identity", "attr:risk=high(device layer, must NOT fire identity)", CARRIER, "device", { risk: "high" }),
  T("security", "attr:securityRisk=high", CARRIER, "device", { securityRisk: "high" }),
  T("security", "attr:edr=disabled", CARRIER, "device", { edr: "disabled" }),
  T("security", "attr:edrRisk=high", CARRIER, "device", { edrRisk: "high" }),
  // device trust
  T("device-trust", "attr:compliance=non_compliant", CARRIER, "device", { compliance: "non_compliant" }),
  T("device-trust", "attr:managementState=unmanaged", CARRIER, "device", { managementState: "unmanaged" }),
  T("device-trust", "attr:deviceCompromised=true(boolean)", CARRIER, "device", { deviceCompromised: true }),
  T("device-trust", "attr:sourceIntegrity=failed", CARRIER, "device", { sourceIntegrity: "failed" }),
  T("device-trust", "type:device.non_compliant", "device.non_compliant", "device", { compliance: "non_compliant" }),
  // state freshness
  T("freshness", "attr:declaredState=stale", CARRIER, "device_state_compliance", { declaredState: "stale" }),
  T("freshness", "attr:ssoStatus=missing", CARRIER, "device_state_compliance", { ssoStatus: "missing" }),
  T("freshness", "attr:freshness=stale", CARRIER, "device", { freshness: "stale" }),
  T("freshness", "attr:criticalInput=malformed", CARRIER, "integration", { criticalInput: "malformed" }),
  T("freshness", "type:device.stale_checkin", "device.stale_checkin", "device", { freshness: "stale" }),
  // custody / dock / location
  T("custody", "attr:zone=wrong", "rtls.location_observed", "location", { zone: "wrong" }),
  T("custody", "attr:location=unknown", "rtls.location_observed", "location", { location: "unknown" }),
  T("custody", "attr:missingReturn=true(boolean)", "dock.device_docked", "dockbridge", { missingReturn: true }),
  T("custody", "attr:overdue=true(boolean)", "dock.device_docked", "dockbridge", { overdue: true }),
  T("custody", "attr:returnBay=wrong", "dock.device_docked", "dockbridge", { returnBay: "wrong" }),
  T("custody", "type:dock.device_undocked(no active session)", "dock.device_undocked", "dockbridge", { dockId: "ED-04" }),
  T("dock", "type:dock.device_missing", "dock.device_missing", "dockbridge", {}),
  T("dock", "type:dock.wrong_slot_return", "dock.wrong_slot_return", "dockbridge", {}),
  T("location", "type:rtls.wrong_zone", "rtls.wrong_zone", "location", { zone: "wrong" }),
  T("location", "type:rts.staff_safety_alert", "rts.staff_safety_alert", "location", {}),
  // workflow routing
  T("workflow", "attr:workflowOwner=missing", "workflow.assignment_changed", "workflow", { workflowOwner: "missing" }),
  T("workflow", "attr:requiredApproval=missing", "workflow.assignment_changed", "workflow", { requiredApproval: "missing" }),
  T("workflow", "attr:escalationDestination=unavailable", "workflow.assignment_changed", "workflow", { escalationDestination: "unavailable" }),
  // operational + integration
  T("ops", "type:device.low_battery", "device.low_battery", "operational_health", { batteryPercent: 7 }),
  T("ops", "type:device.health_degraded", "device.health_degraded", "operational_health", {}),
  T("integration", "type:api.integration_failed", "api.integration_failed", "integration", {}),
  // remediation
  T("remediation", "type:remediation.verified", "remediation.verified", "workflow", { verified: true }),
];

const BASE_TRUST: SignalGridSignal[] = [
  sig("identity.authenticated", "identity", { risk: "low" }),
  sig("device.posture_observed", "device", { compliance: "compliant", freshness: "fresh" }),
];
const APPLE_DECLARED: SignalGridSignal[] = [
  sig("identity.authenticated", "identity", { risk: "low" }),
  sig("apple.ddm_declared_state", "device_state_compliance", { declaredState: "current" }),
];

/** One representative per family, in table order, for the pairwise sweep. */
const FAMILY_REPRESENTATIVES: Trigger[] = (() => {
  const seen = new Set<string>();
  const out: Trigger[] = [];
  for (const t of TRIGGERS) {
    if (seen.has(t.family)) continue;
    seen.add(t.family);
    out.push(t);
  }
  return out;
})();

// ── build the table (pure: same inputs, same bytes) ──────────────────────────
function decide(id: string, group: VectorCase["group"], signals: SignalGridSignal[]): VectorCase {
  const run = runScenario(scenarioOf(id, signals));
  return {
    id,
    group,
    signals: run.normalizedSignals.map(toVectorSignal),
    expectOutcomes: run.decision.outcomes,
    expectReasonCodes: run.decision.reasonCodes,
    expectPrimaryOutcome: run.decision.primaryOutcome,
  };
}

function buildCases(): VectorCase[] {
  const cases: VectorCase[] = [];
  for (const scenario of listSimulatorScenarios()) {
    const run = runScenario(scenario);
    cases.push({
      id: `scenario:${scenario.id}`,
      group: "scenario",
      signals: run.normalizedSignals.map(toVectorSignal),
      expectOutcomes: run.decision.outcomes,
      expectReasonCodes: run.decision.reasonCodes,
      expectPrimaryOutcome: run.decision.primaryOutcome,
    });
  }
  cases.push(decide("base:identity+posture", "base", BASE_TRUST));
  cases.push(decide("base:identity+apple-declared-state", "base", APPLE_DECLARED));
  cases.push(decide("base:nothing", "base", []));
  for (const t of TRIGGERS) {
    cases.push(decide(`single:${t.family}:${t.label}`, "single", [t.signal]));
    cases.push(decide(`single-on-base:${t.family}:${t.label}`, "single-on-base", [...BASE_TRUST, t.signal]));
  }
  cases.push(decide("removal:undock-with-active-session-on-base", "removal", [...BASE_TRUST, sig("dock.device_undocked", "dockbridge", { dockId: "ED-04", active: true })]));
  cases.push(decide("removal:undock-without-active-session-on-base", "removal", [...BASE_TRUST, sig("dock.device_undocked", "dockbridge", { dockId: "ED-04", active: false })]));
  for (let i = 0; i < FAMILY_REPRESENTATIVES.length; i += 1) {
    for (let j = i + 1; j < FAMILY_REPRESENTATIVES.length; j += 1) {
      const a = FAMILY_REPRESENTATIVES[i];
      const b = FAMILY_REPRESENTATIVES[j];
      cases.push(decide(`pair:${a.family}+${b.family}:on-base`, "pair", [...BASE_TRUST, a.signal, b.signal]));
    }
  }
  return cases;
}

function buildDocument() {
  const cases = buildCases();
  const outcomesPresent = [...new Set(cases.flatMap((c) => c.expectOutcomes))].sort();
  const reasonCodesPresent = [...new Set(cases.flatMap((c) => c.expectReasonCodes))].sort();
  return {
    $comment:
      "Shared decision-engine parity vectors. The TypeScript engine (lib/signalgrid-simulator/src/decisionEngine.ts) decided every case; its Swift port (native/ios/EnterpriseShell/Services/DecisionEngine.swift) must reproduce the ordered outcome set and the reason codes for each. Generated by scripts/src/decision-engine-parity-proof.ts — never hand-edited; re-emit with `pnpm run proof:decision-engine-parity -- --emit`. Attribute values are stringified because the port's attributes are [String: String].",
    version: 1,
    rule:
      "For every case, DecisionEngine.evaluate(signals).allOutcomes equals expectOutcomes in order and .reasonCodes equals expectReasonCodes in order. expectPrimaryOutcome is the TS engine's primaryOutcome (its first ordered outcome), recorded for readers; the port's gate outcome is a separate reduction and is not asserted here.",
    source: ENGINE_PATH,
    proof: "scripts/src/decision-engine-parity-proof.ts",
    requires: {
      $comment:
        "Non-vacuity floor, asserted by each client before the cases run. A port that returned the same answer to everything would match some cases; the floor forces a real spread of outcomes and reason codes.",
      minCases: cases.length,
      outcomesPresent,
      reasonCodesPresent,
    },
    cases,
  };
}

// ── 1. the table ─────────────────────────────────────────────────────────────
const document = buildDocument();
const serialized = `${JSON.stringify(document, null, 2)}\n`;
const cases = document.cases;
console.log(`decision-engine parity: ${cases.length} cases (${listSimulatorScenarios().length} scenarios, ${TRIGGERS.length} triggers × 2 contexts, ${FAMILY_REPRESENTATIVES.length} families pairwise)`);

check(`the table clears the 100-case floor (${cases.length})`, cases.length >= 100);
check("every case carries at least one expected outcome (record_audit is unconditional in the engine)", cases.every((c) => c.expectOutcomes.length >= 1));
check("every case's signals carry only string attribute values (the port's attribute type)", cases.every((c) => c.signals.every((s) => Object.values(s.attributes).every((v) => typeof v === "string"))));
check("no case carries a TS STRING \"true\"/\"false\" attribute (outside the shared domain — indistinguishable from the boolean after stringification)", stringBooleanViolations.length === 0);
check("the base-trust case ALLOWS (a restrict-everything port would fail it)", cases.find((c) => c.id === "base:identity+posture")?.expectOutcomes.includes("allow") === true);
check("the empty case records audit only (an allow-everything port would fail it)", JSON.stringify(cases.find((c) => c.id === "base:nothing")?.expectOutcomes) === JSON.stringify(["record_audit"]));
check("a boolean attribute crosses as the string \"true\" and the TS engine decided on the boolean (DEVICE_TRUST_FAILURE fired)", (() => {
  const bool = cases.find((c) => c.id.endsWith("attr:deviceCompromised=true(boolean)") && c.group === "single");
  return bool?.signals[0]?.attributes["deviceCompromised"] === "true" && bool.expectReasonCodes.includes("DEVICE_TRUST_FAILURE");
})());

// ── 2. every reason code the engine can push has a case ──────────────────────
const engineSource = readFileSync(resolve(repoRoot, ENGINE_PATH), "utf8");
const engineReasonCodes = [...new Set([...engineSource.matchAll(/"([A-Z][A-Z0-9_]{5,})"/g)].map((m) => m[1]))].sort();
const present = new Set(document.requires.reasonCodesPresent);
const missing = engineReasonCodes.filter((code) => !present.has(code));
check(`engine source names ${engineReasonCodes.length} reason codes (floor 12)`, engineReasonCodes.length >= 12);
check(`every reason code the engine can push appears in a case${missing.length ? ` — MISSING: ${missing.join(", ")}` : ""}`, missing.length === 0);
check("every decision outcome literal the engine orders appears in a case except deny (no rule emits deny today; REPORTED)", ["allow", "step_up", "restrict", "alert_operator", "create_ticket", "route_to_owner", "request_remediation", "verify_remediation", "record_audit"].every((o) => document.requires.outcomesPresent.includes(o as DecisionOutcome)));

// ── 3. determinism and no clock ──────────────────────────────────────────────
check("building the table twice yields identical bytes", `${JSON.stringify(buildDocument(), null, 2)}\n` === serialized);
check("the table carries no timestamp field (nothing here reads a clock)", !/"(evaluatedAt|emittedAt|generatedAt)"/.test(serialized));

// ── 4. the committed file ────────────────────────────────────────────────────
const vectorFile = resolve(repoRoot, VECTOR_PATH);
if (EMIT) {
  writeFileSync(vectorFile, serialized);
  console.log(`  (emitted ${VECTOR_PATH} — ${cases.length} cases)`);
}
let committed = "";
try {
  committed = readFileSync(vectorFile, "utf8");
} catch {
  committed = "";
}
check(`${VECTOR_PATH} exists and is byte-identical to this table (re-emit with --emit if this fails)`, committed === serialized);
let committedFloor: unknown;
try {
  committedFloor = (JSON.parse(committed) as { requires?: { minCases?: unknown } }).requires?.minCases;
} catch {
  committedFloor = undefined;
}
check(`${VECTOR_PATH} as COMMITTED declares its floor as the live case count (${cases.length})`, committedFloor === cases.length);

// ── verdict ──────────────────────────────────────────────────────────────────
console.log(`\ndecision-engine parity proof: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
