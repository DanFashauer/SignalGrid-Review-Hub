// Posture-allow proof — does an UNKNOWN posture still buy an allow?
//
// The simulator engine grants base-trust `allow` from the PRESENCE of a
// posture-bearing signal and reads its attributes only for known-bad members, so
// `compliance: "unknown"` (or `"expired"`, `"pending"`, a number, an absent key)
// allows exactly as `"compliant"` does. The engine is a byte-faithful port source
// (golden rule 1), so the rule lives in `lib/signalgrid-simulator/src/posture-allow.ts`
// AROUND it, and this proof pins that wrapper.
//
// THE VECTOR TABLE IS THE DELIVERABLE. It is emitted as JSON-serialisable data to
// `native/shared/posture-allow-vectors.json`, in the same shape as the
// remediation-allow vectors, so the Swift twin is ported against pinned cases.
//
//   pnpm run proof:posture-allow            check the committed vectors
//   pnpm run proof:posture-allow -- --emit  rewrite them from this table
//
// WHAT IS GATED: the posture state every signal set classifies to; the host outcome
// and reason code for every (engine outcome × posture state) pair; that the wrapper
// never moves an outcome in the permissive direction; non-vacuity in both directions
// (a wrapper hardcoded to step_up fails, and so does one hardcoded to allow); that
// the LIVE engine still allows the shipping clinical scenario (the wrapper does not
// break the product) and still allows its `compliance: "unknown"` twin (the defect
// is real, measured, and the wrapper — not the engine — withholds it); and that the
// committed vectors are byte-identical to this table.
//
// WHAT IS REPORTED, not gated: the engine's own vocabulary and allow-suppression are
// untouched — this proof never edits or re-derives them.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_OUTCOMES,
  POSTURE_ALLOW_REASONS,
  POSTURE_BEARING,
  POSTURE_STATES,
  classifyPosture,
  listSimulatorScenarios,
  resolvePostureAllow,
  runScenario,
  strictnessOf,
  type DecisionOutcome,
  type HostOutcome,
  type PostureAllowReason,
  type PostureSignal,
  type PostureState,
} from "@workspace/signalgrid-simulator";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VECTOR_PATH = "native/shared/posture-allow-vectors.json";
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

console.log("Posture-allow proof — does an unknown posture still buy an allow?\n");

/** Engine decisions, one per host outcome, with NO finding riding alongside a grant. */
const ENGINE_DECISIONS: Record<HostOutcome, DecisionOutcome[]> = {
  allow: ["allow", "record_audit"],
  step_up: ["step_up", "request_remediation", "record_audit"],
  restrict: ["restrict", "alert_operator", "create_ticket", "record_audit"],
  deny: ["deny", "record_audit"],
};

const posture = (attributes: PostureSignal["attributes"]): PostureSignal => ({
  type: "device.posture_observed",
  attributes,
});
const ddm = (attributes: PostureSignal["attributes"]): PostureSignal => ({
  type: "apple.ddm_declared_state",
  attributes,
});
const IDENTITY: PostureSignal = { type: "identity.authenticated", attributes: { risk: "low" } };

/** One signal set per posture state, plus the variants that have their own cause. */
const SIGNAL_SETS: Record<string, { state: PostureState; why: string; signals: PostureSignal[] }> = {
  affirmed: {
    state: "affirmed",
    why: "compliant and fresh — the only reading that may keep a grant",
    signals: [IDENTITY, posture({ compliance: "compliant", freshness: "fresh" })],
  },
  affirmed_ddm: {
    state: "affirmed",
    why: "an Apple declared state that is current and compliant affirms too",
    signals: [IDENTITY, ddm({ declaredState: "current", configurationStatus: "applied", compliance: "compliant" })],
  },
  affirmed_managed: {
    state: "affirmed",
    why: "managementState is optional; when present it must read managed, and here it does",
    signals: [IDENTITY, posture({ compliance: "compliant", freshness: "fresh", managementState: "managed" })],
  },
  compliance_unknown: {
    state: "unaffirmed",
    why: "THE DEFECT: compliance unknown matches no bad literal in the engine, so the engine allows; unknown is not compliant",
    signals: [IDENTITY, posture({ compliance: "unknown", freshness: "fresh" })],
  },
  freshness_expired: {
    state: "unaffirmed",
    why: "the engine reads freshness only for the literal stale; expired is not fresh either",
    signals: [IDENTITY, posture({ compliance: "compliant", freshness: "expired" })],
  },
  ddm_pending: {
    state: "unaffirmed",
    why: "a declared state that is pending has not declared anything current",
    signals: [IDENTITY, ddm({ declaredState: "pending", configurationStatus: "applied", compliance: "compliant" })],
  },
  management_unknown: {
    state: "unaffirmed",
    why: "managementState present and not managed — the engine only fails on the literal unmanaged",
    signals: [IDENTITY, posture({ compliance: "compliant", freshness: "fresh", managementState: "unknown" })],
  },
  compliance_absent: {
    state: "illegible",
    why: "a posture signal with no compliance key claims nothing; absence is not a reading",
    signals: [IDENTITY, posture({ freshness: "fresh" })],
  },
  compliance_numeric: {
    state: "illegible",
    why: "a compliance value that is not a string cannot be read as any member",
    signals: [IDENTITY, posture({ compliance: 1, freshness: "fresh" })],
  },
  compliance_null: {
    state: "illegible",
    why: "null is the shape a connector emits when it could not read the field",
    signals: [IDENTITY, posture({ compliance: null, freshness: "fresh" })],
  },
  second_signal_unaffirmed: {
    state: "unaffirmed",
    why: "an affirmed posture beside an unaffirmed one is unaffirmed — adding a signal never buys leniency",
    signals: [IDENTITY, posture({ compliance: "compliant", freshness: "fresh" }), posture({ compliance: "unknown", freshness: "fresh" })],
  },
  illegible_outranks_unaffirmed: {
    state: "illegible",
    why: "one unreadable and one unaffirmed attribute: the least legible names the state, both are listed",
    signals: [IDENTITY, posture({ compliance: "unknown" })],
  },
  absent: {
    state: "absent",
    why: "no posture-bearing signal at all — the engine cannot base-trust allow, but a caller can hand any outcome set in",
    signals: [IDENTITY],
  },
};

interface Vector {
  id: string;
  why: string;
  engineOutcomes: DecisionOutcome[];
  signals: PostureSignal[];
  expectEngineOutcome: HostOutcome;
  expectState: PostureState;
  expectOutcome: HostOutcome;
  expectReasonCode: PostureAllowReason;
  expectAllowWithheld: boolean;
}

const WITHHELD_REASON: Partial<Record<PostureState, PostureAllowReason>> = {
  unaffirmed: "ALLOW_WITHHELD_POSTURE_UNAFFIRMED",
  illegible: "ALLOW_WITHHELD_POSTURE_ILLEGIBLE",
  absent: "ALLOW_WITHHELD_POSTURE_ILLEGIBLE",
};
const STATE_REASON: Record<PostureState, PostureAllowReason> = {
  affirmed: "POSTURE_AFFIRMED",
  unaffirmed: "POSTURE_UNAFFIRMED",
  illegible: "POSTURE_ILLEGIBLE",
  absent: "POSTURE_ABSENT",
};

// ── THE CROSS PRODUCT: every engine outcome × every signal set ───────────────
const vectors: Vector[] = [];
for (const engineOutcome of HOST_OUTCOMES) {
  for (const [setId, set] of Object.entries(SIGNAL_SETS)) {
    const withheld = engineOutcome === "allow" && set.state !== "affirmed";
    vectors.push({
      id: `${engineOutcome}-${setId}`,
      why: set.why,
      engineOutcomes: ENGINE_DECISIONS[engineOutcome],
      signals: set.signals,
      expectEngineOutcome: engineOutcome,
      expectState: set.state,
      expectOutcome: withheld ? "step_up" : engineOutcome,
      expectReasonCode: withheld ? (WITHHELD_REASON[set.state] as PostureAllowReason) : STATE_REASON[set.state],
      expectAllowWithheld: withheld,
    });
  }
}

// ── 1. EVERY VECTOR, both halves: classification and resolution ──────────────
for (const v of vectors) {
  const { state } = classifyPosture(v.signals);
  check(`${v.id}: posture classifies as ${v.expectState}`, state === v.expectState);
  const out = resolvePostureAllow({ decision: { outcomes: v.engineOutcomes }, signals: v.signals });
  check(
    `${v.id}: engine ${v.expectEngineOutcome} -> host ${v.expectOutcome} (${v.expectReasonCode})`,
    out.engineOutcome === v.expectEngineOutcome &&
      out.hostOutcome === v.expectOutcome &&
      out.reasonCode === v.expectReasonCode &&
      out.allowWithheld === v.expectAllowWithheld &&
      out.postureState === v.expectState,
  );
  check(
    `${v.id}: never moved in the permissive direction`,
    strictnessOf(out.hostOutcome) >= strictnessOf(out.engineOutcome),
  );
}

// ── 2. DEFICIENCIES ARE NAMED, all of them ───────────────────────────────────
{
  const both = classifyPosture(SIGNAL_SETS.illegible_outranks_unaffirmed.signals);
  check(
    "a set with one unaffirmed and one illegible attribute lists BOTH deficiencies",
    both.deficiencies.length === 2 &&
      both.deficiencies.some((d) => d.attribute === "compliance" && d.kind === "unaffirmed") &&
      both.deficiencies.some((d) => d.attribute === "freshness" && d.kind === "illegible"),
  );
  const two = classifyPosture(SIGNAL_SETS.second_signal_unaffirmed.signals);
  check("the deficient signal is named by type, in signal order", two.deficiencies.length === 1 && two.deficiencies[0].signalType === "device.posture_observed");
  check("an affirmed set lists no deficiency", classifyPosture(SIGNAL_SETS.affirmed.signals).deficiencies.length === 0);
  check(
    "a non-posture signal type is never judged, whatever its attributes say",
    classifyPosture([{ type: "device.stale_checkin", attributes: { compliance: "unknown", freshness: "stale" } }]).state === "absent",
  );
  check(
    "attributes that are not an object read as illegible, not as affirmed",
    classifyPosture([{ type: "device.posture_observed", attributes: null as unknown as PostureSignal["attributes"] }]).state === "illegible",
  );
  check(
    "a required attribute inherited from the prototype does not count as present",
    classifyPosture([posture(Object.create({ compliance: "compliant", freshness: "fresh" }) as PostureSignal["attributes"])]).state === "illegible",
  );
}

// ── 3. NON-VACUITY, both directions ──────────────────────────────────────────
check("some vector expects ALLOW (a wrapper hardcoded to step_up would fail)", vectors.some((v) => v.expectOutcome === "allow"));
check("some vector withholds an offered allow (a wrapper hardcoded to allow would fail)", vectors.some((v) => v.expectAllowWithheld));
for (const state of POSTURE_STATES) check(`posture state "${state}" is exercised`, vectors.some((v) => v.expectState === state));
for (const reason of POSTURE_ALLOW_REASONS) check(`reason code "${reason}" is expected by some vector`, vectors.some((v) => v.expectReasonCode === reason));
for (const outcome of HOST_OUTCOMES) check(`engine outcome "${outcome}" is crossed`, vectors.some((v) => v.expectEngineOutcome === outcome));
const ids = vectors.map((v) => v.id);
check("vector ids are unique", new Set(ids).size === ids.length);
check("every vector states WHY it exists", vectors.every((v) => v.why.length > 20));
check(
  "every attribute the engine consults on a posture signal is in the wrapper's table",
  ["compliance", "freshness", "managementState", "declaredState"].every((a) =>
    Object.values(POSTURE_BEARING).some((spec) => a in spec.required || a in spec.optional),
  ),
);

// ── 4. THE LIVE ENGINE ───────────────────────────────────────────────────────
// Bound to the REAL simulator: the shipping clinical scenario must still allow
// through the wrapper (non-vacuity against the product), and its unknown-compliance
// twin must be allowed BY THE ENGINE (the defect is real) and withheld BY THE
// WRAPPER (the fix is real).
const clinical = listSimulatorScenarios().find((s) => s.expectedOutcomes.includes("allow") && s.startingSignals.some((x) => x.type === "device.posture_observed"));
check("a shipping scenario allows from an observed posture", clinical !== undefined);
if (clinical) {
  const clean = runScenario(clinical);
  const cleanOut = resolvePostureAllow({ decision: clean.decision, signals: clean.normalizedSignals });
  check(
    `live engine: ${clinical.id} still allows through the wrapper (the wrapper does not break the product)`,
    clean.decision.outcomes.includes("allow") && cleanOut.hostOutcome === "allow" && cleanOut.reasonCode === "POSTURE_AFFIRMED",
  );
  const twin = runScenario({
    ...clinical,
    id: `${clinical.id}-compliance-unknown`,
    startingSignals: clinical.startingSignals.map((s) =>
      s.type === "device.posture_observed" ? { ...s, attributes: { ...s.attributes, compliance: "unknown" } } : s,
    ),
  });
  check(
    "live engine: the SAME scenario with compliance unknown is STILL allowed by the engine (the defect, measured — REPORTED so the wrapper's reason to exist stays visible)",
    twin.decision.outcomes.includes("allow"),
  );
  const twinOut = resolvePostureAllow({ decision: twin.decision, signals: twin.normalizedSignals });
  check(
    "live engine: the wrapper withholds that allow to step_up with the unaffirmed reason",
    twinOut.hostOutcome === "step_up" && twinOut.allowWithheld && twinOut.reasonCode === "ALLOW_WITHHELD_POSTURE_UNAFFIRMED",
  );
  const stripped = runScenario({
    ...clinical,
    id: `${clinical.id}-compliance-absent`,
    startingSignals: clinical.startingSignals.map((s) => {
      if (s.type !== "device.posture_observed") return s;
      const { compliance: _dropped, ...rest } = s.attributes;
      return { ...s, attributes: rest };
    }),
  });
  const strippedOut = resolvePostureAllow({ decision: stripped.decision, signals: stripped.normalizedSignals });
  check(
    "live engine: a posture signal with NO compliance key is withheld as illegible",
    stripped.decision.outcomes.includes("allow") && strippedOut.hostOutcome === "step_up" && strippedOut.reasonCode === "ALLOW_WITHHELD_POSTURE_ILLEGIBLE",
  );
}

// ── 5. SELF-TEST: the proof can fail ─────────────────────────────────────────
{
  const caught: string[] = [];
  const hardcodedAllow = (v: Vector): HostOutcome => v.expectEngineOutcome;
  for (const v of vectors) if (hardcodedAllow(v) !== v.expectOutcome) caught.push(v.id);
  check(`self-test: a wrapper that passes every engine outcome through is CAUGHT (${caught.length} vectors)`, caught.length > 0 && caught.includes("allow-compliance_unknown"));
}

// ── 6. THE SHARED VECTOR FILE ────────────────────────────────────────────────
const document = {
  $comment:
    "Shared posture-allow vectors. The TypeScript wrapper (lib/signalgrid-simulator/src/posture-allow.ts) and its Swift twin must agree on EVERY case. Generated by scripts/src/posture-allow-proof.ts — do not hand-edit; run `pnpm run proof:posture-allow -- --emit`.",
  version: 1,
  rule:
    "An allow the engine offered stands only if EVERY posture-bearing signal in the decision's input AFFIRMS every posture attribute the engine consults: a device.posture_observed must read compliance compliant and freshness fresh, an apple.ddm_declared_state must read declaredState current and compliance compliant, and managementState, when either carries it, must read managed. Any other member is UNAFFIRMED; an attribute absent where required, or not a string, is ILLEGIBLE. Either withholds the allow, which drops to the NEXT-STRICTER outcome with a named reason code; an unaffirmed or illegible posture raises the outcome and never lowers it; and this wrapper never moves the engine's own outcome in the permissive direction.",
  source: "lib/signalgrid-simulator/src/posture-allow.ts",
  proof: "scripts/src/posture-allow-proof.ts",
  postureBearing: POSTURE_BEARING,
  requires: {
    $comment:
      "Non-vacuity floor, asserted by each client before the cases run. Without it a client that returns step_up unconditionally passes every withholding case and the suite proves nothing.",
    minCases: vectors.length,
    outcomesPresent: [...HOST_OUTCOMES],
    statesPresent: [...POSTURE_STATES],
    reasonCodesPresent: [...POSTURE_ALLOW_REASONS],
  },
  cases: vectors,
};
const serialized = `${JSON.stringify(document, null, 2)}\n`;
const vectorFile = resolve(repoRoot, VECTOR_PATH);
if (EMIT) {
  writeFileSync(vectorFile, serialized);
  console.log(`  (emitted ${VECTOR_PATH} — ${vectors.length} cases)`);
}
let committed = "";
try {
  committed = readFileSync(vectorFile, "utf8");
} catch {
  committed = "";
}
check(`${VECTOR_PATH} exists and is byte-identical to this table (re-emit with --emit if this fails)`, committed === serialized);
check(`${VECTOR_PATH} declares its own floor as the case count (${vectors.length})`, document.requires.minCases === vectors.length && vectors.length >= 40);

console.log(`\nfigures=vectors=${vectors.length},states=${POSTURE_STATES.length},reasonCodes=${POSTURE_ALLOW_REASONS.length},engineOutcomes=${HOST_OUTCOMES.length}`);
console.log(`\nPosture-allow proof: ${passed}/${passed + failures.length} checks passed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
