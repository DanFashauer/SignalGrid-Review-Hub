// App-workflows parity proof — the shared vector table the Swift planner port replays.
//
// WHAT THIS PINS. `native/ios/EnterpriseShell/Services/AppWorkflows.swift` is the native
// port of `lib/app-workflows/src/index.ts` — the Assist planner that decides, for every
// action an integrated app can perform, auto / assist / step-up / blocked / applied. It
// is the other ported file CLAUDE.md golden rule 1 names, and until 2026-09-26 the only
// gate on it was `scripts/check-decision-port-parity.mjs` section 3b: record SHAPES,
// field for field. Shapes cannot see a rule whose fields match and whose logic does not
// — which is exactly what BUILD_BACKLOG row 101 recorded: the TS planner releases a
// step-up PER ACTION (`stepUpSatisfiedActionKeys`), the port released everything or
// nothing. This proof runs the TS planner over a deterministic table and emits what it
// DECIDED to `native/shared/app-workflows-vectors.json`; the Swift twin
// (`native/ios/EnterpriseShellTests/AppWorkflowsParityTests.swift`) reads that file by
// path, replays every case through `AppWorkflows.planAppSession`, and asserts the mode,
// the summary, and every action's disposition, confirmation flag and reason.
//
//   pnpm run proof:app-workflows-parity            check the committed vectors
//   pnpm run proof:app-workflows-parity -- --emit  rewrite them from the planner
//
// THE CASES. Every catalog integration (`lib/app-workflows/src/catalog.ts`, public-safe
// generic categories) plus three synthetic ones — an unknown vertical (pins the
// confirmer default), an integration with NO held actions (pins the vacuity rule), and a
// read-only one — each under: deny; restrict (with and without a reason code, so the
// fallback text is pinned); allow unconfirmed / first sensitive confirmed / all sensitive
// confirmed / a bogus key confirmed / a confirmer override; step_up with no release, a
// FULL release, a release SCOPED to the first held action, scoped to every held action,
// scoped to a bogus key, scoped to nothing, and full+scoped together. The scoped cases are
// what row 101 is about: a gesture for one action must never release the rest.
//
// WHAT IS GATED: the table clears its floors; every disposition and every mode the
// planner can produce appears; the scoped-first-held case really leaves something held
// that the full release frees (so the scoped semantics are exercised, not just named);
// building twice yields the same bytes; no clock; and the committed file is
// byte-identical to the table (re-emit on a red). Nothing here modifies either ported
// file.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_INTEGRATIONS, planAppSession, type AppIntegration, type AppPlanInput, type AppSessionPlan } from "@workspace/app-workflows";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VECTOR_PATH = "native/shared/app-workflows-vectors.json";
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

type Outcome = AppPlanInput["outcome"];

interface VectorInput {
  outcome: Outcome;
  reasonCodes: string[];
  confirmedActionKeys: string[];
  stepUpSatisfied: boolean;
  stepUpSatisfiedActionKeys: string[];
  confirmer: string | null;
}
interface VectorCase {
  id: string;
  integration: AppIntegration;
  input: VectorInput;
  expect: {
    outcome: string;
    mode: AppSessionPlan["mode"];
    summary: string;
    actions: AppSessionPlan["actions"];
  };
}

// The three synthetic integrations (generic categories, never a real product).
const SYNTHETIC: AppIntegration[] = [
  {
    id: "parity-unknown-vertical",
    name: "Unknown-vertical app",
    category: "Parity fixture",
    // Deliberately outside AppVertical: the planner's confirmer default for a vertical
    // the table does not know is what this case pins.
    vertical: "aerospace" as AppIntegration["vertical"],
    workflowKey: "parity-session",
    actions: [
      { key: "read.view", label: "View record", riskTier: "standard", sensitive: false, gatedByStepUp: false },
      { key: "act.commit", label: "Commit change", riskTier: "critical", sensitive: true, gatedByStepUp: true },
    ],
  },
  {
    id: "parity-no-held-actions",
    name: "All-standard app",
    category: "Parity fixture",
    vertical: "healthcare",
    workflowKey: "parity-session",
    actions: [
      { key: "read.a", label: "Read A", riskTier: "standard", sensitive: false, gatedByStepUp: false },
      { key: "read.b", label: "Read B", riskTier: "standard", sensitive: false, gatedByStepUp: false },
    ],
  },
  {
    id: "parity-read-only",
    name: "Read-only app",
    category: "Parity fixture",
    vertical: "retail",
    workflowKey: "parity-session",
    actions: [{ key: "read.only", label: "Read", riskTier: "elevated", sensitive: false, gatedByStepUp: true }],
  },
];

const INTEGRATIONS: AppIntegration[] = [...APP_INTEGRATIONS, ...SYNTHETIC];

const baseInput = (integration: AppIntegration, outcome: Outcome, reasonCodes: string[], extra: Partial<VectorInput> = {}): VectorInput => ({
  outcome,
  reasonCodes,
  confirmedActionKeys: [],
  stepUpSatisfied: false,
  stepUpSatisfiedActionKeys: [],
  confirmer: null,
  ...extra,
});

function decide(id: string, integration: AppIntegration, input: VectorInput): VectorCase {
  const planInput: AppPlanInput = {
    integration,
    outcome: input.outcome,
    reasonCodes: input.reasonCodes,
    confirmedActionKeys: input.confirmedActionKeys,
    stepUpSatisfied: input.stepUpSatisfied,
    stepUpSatisfiedActionKeys: input.stepUpSatisfiedActionKeys,
    ...(input.confirmer === null ? {} : { confirmer: input.confirmer }),
  };
  const plan = planAppSession(planInput);
  return {
    id,
    integration,
    input,
    expect: { outcome: plan.outcome, mode: plan.mode, summary: plan.summary, actions: plan.actions },
  };
}

function buildCases(): VectorCase[] {
  const cases: VectorCase[] = [];
  for (const integration of INTEGRATIONS) {
    const p = integration.id;
    const held = integration.actions.filter((a) => a.gatedByStepUp || a.sensitive).map((a) => a.key);
    const sensitive = integration.actions.filter((a) => a.sensitive).map((a) => a.key);
    cases.push(decide(`${p}:deny`, integration, baseInput(integration, "deny", ["IDENTITY_INTEGRITY_FAILURE"])));
    cases.push(decide(`${p}:restrict`, integration, baseInput(integration, "restrict", ["DEVICE_TRUST_FAILURE"])));
    cases.push(decide(`${p}:restrict:no-reason-code`, integration, baseInput(integration, "restrict", [])));
    cases.push(decide(`${p}:allow:unconfirmed`, integration, baseInput(integration, "allow", ["IDENTITY_AND_POSTURE_TRUSTED"])));
    cases.push(decide(`${p}:allow:first-sensitive-confirmed`, integration, baseInput(integration, "allow", [], { confirmedActionKeys: sensitive.slice(0, 1) })));
    cases.push(decide(`${p}:allow:all-sensitive-confirmed`, integration, baseInput(integration, "allow", [], { confirmedActionKeys: [...sensitive] })));
    cases.push(decide(`${p}:allow:bogus-key-confirmed`, integration, baseInput(integration, "allow", [], { confirmedActionKeys: ["bogus.key"] })));
    cases.push(decide(`${p}:allow:confirmer-override`, integration, baseInput(integration, "allow", [], { confirmer: "charge nurse" })));
    cases.push(decide(`${p}:step_up:no-release`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"])));
    cases.push(decide(`${p}:step_up:no-release:no-reason-code`, integration, baseInput(integration, "step_up", [])));
    cases.push(decide(`${p}:step_up:full-release`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfied: true })));
    cases.push(decide(`${p}:step_up:scoped-first-held`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfiedActionKeys: held.slice(0, 1) })));
    cases.push(decide(`${p}:step_up:scoped-all-held`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfiedActionKeys: [...held] })));
    cases.push(decide(`${p}:step_up:scoped-bogus-key`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfiedActionKeys: ["bogus.key"] })));
    cases.push(decide(`${p}:step_up:scoped-empty`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfiedActionKeys: [] })));
    cases.push(decide(`${p}:step_up:full-and-scoped-first-held`, integration, baseInput(integration, "step_up", ["POSTURE_STALE"], { stepUpSatisfied: true, stepUpSatisfiedActionKeys: held.slice(0, 1) })));
  }
  return cases;
}

function buildDocument() {
  const cases = buildCases();
  const dispositionsPresent = [...new Set(cases.flatMap((c) => c.expect.actions.map((a) => a.disposition)))].sort();
  const modesPresent = [...new Set(cases.map((c) => c.expect.mode))].sort();
  const verticalsPresent = [...new Set(cases.map((c) => c.integration.vertical as string))].sort();
  return {
    $comment:
      "Shared app-workflows (Assist planner) parity vectors. The TypeScript planner (lib/app-workflows/src/index.ts) decided every case; its Swift port (native/ios/EnterpriseShell/Services/AppWorkflows.swift) must reproduce the mode, the summary, and every action's disposition, requiresConfirmation and reason. Generated by scripts/src/app-workflows-parity-proof.ts — never hand-edited; re-emit with `pnpm run proof:app-workflows-parity -- --emit`. A null `confirmer` means the input carried none.",
    version: 1,
    rule:
      "For every case, AppWorkflows.planAppSession(input) yields expect.mode, expect.summary and, per action in order, expect.actions[i].disposition / requiresConfirmation / reason. The scoped step-up release (input.stepUpSatisfiedActionKeys) releases ONLY the named held actions; a gesture for one action never releases the rest.",
    source: "lib/app-workflows/src/index.ts",
    proof: "scripts/src/app-workflows-parity-proof.ts",
    requires: {
      $comment:
        "Non-vacuity floor, asserted by each client before the cases run. A port that blocked everything, or released everything on any step-up, would match some cases; the floor forces every disposition and every mode to be exercised.",
      minCases: cases.length,
      dispositionsPresent,
      modesPresent,
      verticalsPresent,
    },
    cases,
  };
}

// ── 1. the table ─────────────────────────────────────────────────────────────
const document = buildDocument();
const serialized = `${JSON.stringify(document, null, 2)}\n`;
const cases = document.cases;
console.log(`app-workflows parity: ${cases.length} cases (${INTEGRATIONS.length} integrations — ${APP_INTEGRATIONS.length} catalog + ${SYNTHETIC.length} synthetic — × 16 inputs)`);

check(`the table clears the 100-case floor (${cases.length})`, cases.length >= 100);
check("every disposition the planner can produce appears (auto, assist, step_up, blocked, applied)", ["auto", "assist", "step_up", "blocked", "applied"].every((d) => document.requires.dispositionsPresent.includes(d as never)));
check("every mode the planner can produce appears (proceed, assist, step_up, hold, deny)", ["proceed", "assist", "step_up", "hold", "deny"].every((m) => document.requires.modesPresent.includes(m as never)));
check("the unknown-vertical case pins the confirmer default (\"an authorized confirmer\" in a reason)", cases.some((c) => c.integration.id === "parity-unknown-vertical" && c.expect.actions.some((a) => a.reason.includes("an authorized confirmer"))));
check("a scoped release to the first held action leaves another held action held in at least one integration — the scoped semantics are exercised, not just named", INTEGRATIONS.some((integration) => {
  const scoped = cases.find((c) => c.id === `${integration.id}:step_up:scoped-first-held`);
  const full = cases.find((c) => c.id === `${integration.id}:step_up:full-release`);
  if (!scoped || !full) return false;
  const stillHeld = scoped.expect.actions.filter((a) => a.disposition === "step_up").length;
  const heldAfterFull = full.expect.actions.filter((a) => a.disposition === "step_up").length;
  return stillHeld > 0 && heldAfterFull === 0 && scoped.expect.mode === "step_up";
}));
check("a scoped release covering every held action is equivalent to a full release (same mode and dispositions) in every integration that has a held action", INTEGRATIONS.every((integration) => {
  const held = integration.actions.some((a) => a.gatedByStepUp || a.sensitive);
  if (!held) return true;
  const all = cases.find((c) => c.id === `${integration.id}:step_up:scoped-all-held`);
  const full = cases.find((c) => c.id === `${integration.id}:step_up:full-release`);
  return !!all && !!full && all.expect.mode === full.expect.mode && JSON.stringify(all.expect.actions.map((a) => a.disposition)) === JSON.stringify(full.expect.actions.map((a) => a.disposition));
}));
check("a bogus scoped key releases nothing (identical to no release) in every integration", INTEGRATIONS.every((integration) => {
  const bogus = cases.find((c) => c.id === `${integration.id}:step_up:scoped-bogus-key`);
  const none = cases.find((c) => c.id === `${integration.id}:step_up:no-release`);
  return !!bogus && !!none && JSON.stringify(bogus.expect) === JSON.stringify(none.expect);
}));

// ── 2. determinism and no clock ──────────────────────────────────────────────
check("building the table twice yields identical bytes", `${JSON.stringify(buildDocument(), null, 2)}\n` === serialized);
check("the table carries no timestamp field (nothing here reads a clock)", !/"(evaluatedAt|emittedAt|generatedAt)"/.test(serialized));

// ── 3. the committed file ────────────────────────────────────────────────────
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
console.log(`\napp-workflows parity proof: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
