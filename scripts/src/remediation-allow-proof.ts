// Remediation-allow proof — the vector table the Swift twin will be ported against.
//
// WHAT THIS PINS. `lib/signalgrid-simulator/src/remediation-allow.ts` decides whether
// an `allow` the engine offered survives contact with the remediation record. It is
// the fix for the simulator remediation-allow path, and it lives OUTSIDE the engine
// because `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is a byte-faithful
// port of the engine body (CLAUDE.md golden rule 1). Nothing in this proof, and nothing
// in the module it proves, modifies either ported file.
//
// THE VECTOR TABLE IS THE DELIVERABLE. It is emitted as JSON-serialisable data to
// `native/shared/remediation-allow-vectors.json`, in the same shape as
// `native/shared/assist-wire-conformance.json`, so the Swift twin binds to the SAME
// file rather than to a Swift transcription of it. The lane order was agreed in
// `artifacts/lane-messages/`: the cloud lane writes the TS wrapper and its proof
// FIRST because the wrapper's shape — which failures withhold allow alongside a
// remediation record — is a design decision; the Mac lane ports the Swift twin
// second, against these pinned vectors.
//
//   pnpm run proof:remediation-allow            check the committed vectors
//   pnpm run proof:remediation-allow -- --emit  rewrite them from this table
//
// WHAT IS GATED, because each is unambiguous: the state every record resolves to,
// the host outcome and reason code for every (engine outcome x remediation state)
// pair, monotonicity across the state axis, non-vacuity, and that the committed
// vector file is byte-identical to the table derived here.
//
// WHAT IS REPORTED, not gated: whether the ENGINE still emits the raw `allow` this
// wrapper takes away. That is deliberate. Asserting the engine still fails would turn
// a future correct fix inside the engine into a red gate — a proof that punishes the
// repair it exists to motivate. The wrapper's refusal is asserted unconditionally;
// the engine's behaviour is printed.
//
// The defect is LATENT, not shipped. On iOS `remediation.verified` is appended only
// from a DemoMode-injected flag (SignalContext.swift:92-95, gated on `ctx.injected`),
// and no Swift producer exists for `api.integration_failed`, `device.low_battery` or
// `device.health_degraded` at all — DecisionEngine.swift:112-121 consumes them and
// nothing in the shell emits them. So the combination is not constructible from live
// input on either side today. The rule is pinned BEFORE the wiring that would make it
// reachable, not after.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_OUTCOMES,
  REMEDIATION_ALLOW_REASONS,
  REMEDIATION_STATES,
  classifyRemediation,
  listSimulatorScenarios,
  projectEngineOutcome,
  resolveRemediationAllow,
  runScenario,
  strictnessOf,
  type DecisionOutcome,
  type HostOutcome,
  type RemediationAllowReason,
  type RemediationRecord,
  type RemediationState,
} from "@workspace/signalgrid-simulator";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VECTOR_PATH = "native/shared/remediation-allow-vectors.json";
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

console.log("Remediation-allow proof — does a remediation record still buy an allow?\n");

// ── FIXTURE INSTANTS ─────────────────────────────────────────────────────────
// Fixed strings, never a clock: the Swift twin has to reproduce every vector.
const AS_OF = "2026-06-09T14:05:00.000Z";
const FRESH_AT = "2026-06-09T13:55:00.000Z"; // 10 minutes before AS_OF
const OLD_AT = "2026-06-09T11:05:00.000Z"; // 3 hours before AS_OF
const FUTURE_AT = "2026-06-09T14:35:00.000Z"; // 30 minutes AFTER AS_OF
const MAX_AGE_MS = 3_600_000; // one hour

/** A record for each state, plus the illegibility variants that have their own cause. */
const RECORDS: Record<string, RemediationRecord | null> = {
  verified: { id: "rem-1", status: "verified", verifiedAt: FRESH_AT },
  recorded_unverified: { id: "rem-2", status: "requested", verifiedAt: null },
  recorded_failed: { id: "rem-3", status: "verification_failed", verifiedAt: null },
  stale: { id: "rem-4", status: "verified", verifiedAt: OLD_AT },
  absent: null,
  illegible: { id: "rem-6", status: "verified", verifiedAt: "not-a-date" },
};

/** Engine decisions, one per host outcome, with NO finding riding alongside a grant. */
const ENGINE_DECISIONS: Record<HostOutcome, DecisionOutcome[]> = {
  allow: ["verify_remediation", "allow", "record_audit"],
  step_up: ["step_up", "request_remediation", "record_audit"],
  restrict: ["restrict", "alert_operator", "create_ticket", "record_audit"],
  deny: ["deny", "record_audit"],
};

interface Vector {
  id: string;
  why: string;
  engineOutcomes: DecisionOutcome[];
  record: RemediationRecord | null;
  asOf: string;
  evidenceMaxAgeMs: number;
  policyRequiresRemediation: boolean;
  expectEngineOutcome: HostOutcome;
  expectState: RemediationState;
  expectOutcome: HostOutcome;
  expectReasonCode: RemediationAllowReason;
  expectAllowWithheld: boolean;
}

const vectors: Vector[] = [];

// ── GROUP A: the full cross product, remediation REQUIRED ────────────────────
// 4 engine outcomes x 6 remediation states. The requirement is stated by policy on
// every row so the axis is clean; `absent` therefore means absent-where-required.
const STATE_NOTE: Record<RemediationState, string> = {
  verified: "verified and inside the evidence window — the only state that may keep a grant",
  recorded_unverified: "a record exists and nothing verified it; recorded is not verified",
  recorded_failed: "the verification ran and FAILED — the strongest evidence against a grant",
  stale: "verified three hours ago against a one-hour window; expired evidence is not evidence",
  absent: "the decision required a remediation and none arrived",
  illegible: "the verification instant cannot be parsed; unreadable raises, it never reads fresh",
};
const EXPECT_REASON: Record<RemediationState, RemediationAllowReason> = {
  verified: "REMEDIATION_VERIFIED",
  recorded_unverified: "REMEDIATION_RECORDED_NOT_VERIFIED",
  recorded_failed: "REMEDIATION_VERIFICATION_FAILED",
  stale: "REMEDIATION_EVIDENCE_STALE",
  absent: "REMEDIATION_ABSENT_WHERE_REQUIRED",
  illegible: "REMEDIATION_STATE_ILLEGIBLE",
};

for (const engineOutcome of HOST_OUTCOMES) {
  for (const state of REMEDIATION_STATES) {
    const deficient = state !== "verified";
    const withheld = engineOutcome === "allow" && deficient;
    vectors.push({
      id: `engine-${engineOutcome}-x-${state}`,
      why: `engine says ${engineOutcome}; ${STATE_NOTE[state]}`,
      engineOutcomes: ENGINE_DECISIONS[engineOutcome],
      record: RECORDS[state],
      asOf: AS_OF,
      evidenceMaxAgeMs: MAX_AGE_MS,
      policyRequiresRemediation: true,
      expectEngineOutcome: engineOutcome,
      expectState: state,
      expectOutcome: withheld ? "step_up" : engineOutcome,
      expectReasonCode: EXPECT_REASON[state],
      expectAllowWithheld: withheld,
    });
  }
}

// ── GROUP B: nothing required a remediation ──────────────────────────────────
// The honest-idiom cases. An ordinary decision with no remediation anywhere near it
// must be left completely alone; a wrapper that punished these would fire on correct
// behaviour, which is the failure mode this repository keeps re-learning.
for (const engineOutcome of HOST_OUTCOMES) {
  const outcomes: DecisionOutcome[] =
    engineOutcome === "allow"
      ? ["allow", "record_audit"]
      : ENGINE_DECISIONS[engineOutcome].filter(
          (o) => o !== "request_remediation" && o !== "verify_remediation",
        );
  vectors.push({
    id: `not-required-${engineOutcome}-absent`,
    why: `no remediation was required and none exists; the engine's ${engineOutcome} must pass through untouched`,
    engineOutcomes: outcomes,
    record: null,
    asOf: AS_OF,
    evidenceMaxAgeMs: MAX_AGE_MS,
    policyRequiresRemediation: false,
    expectEngineOutcome: engineOutcome,
    expectState: "absent",
    expectOutcome: engineOutcome,
    expectReasonCode: "REMEDIATION_NOT_REQUIRED",
    expectAllowWithheld: false,
  });
}

// ── GROUP C: the defect itself — a finding riding alongside the grant ────────
// Verified remediation + authenticated identity + posture, PLUS a finding that the
// engine's allow-suppression does not cover. The engine emits `allow`; the identical
// evidence without the remediation record does not. Each of these withholds.
const CONCURRENT: Array<{ id: string; outcomes: DecisionOutcome[]; why: string }> = [
  {
    id: "concurrent-integration-degraded",
    outcomes: ["alert_operator", "route_to_owner", "verify_remediation", "allow", "record_audit"],
    why: "api.integration_failed -> INTEGRATION_ROUTE_DEGRADED rides alongside a verified remediation; the engine's suppression covers only restrict/deny/step_up and custody",
  },
  {
    id: "concurrent-low-battery",
    outcomes: ["alert_operator", "route_to_owner", "verify_remediation", "allow", "record_audit"],
    why: "device.low_battery -> BATTERY_WORKFLOW_RISK, same shape: a finding the base-trust allow would have refused outright",
  },
  {
    id: "concurrent-health-degraded",
    outcomes: ["create_ticket", "route_to_owner", "verify_remediation", "allow", "record_audit"],
    why: "device.health_degraded -> OPERATIONAL_HEALTH_DEGRADED, same shape",
  },
];
for (const c of CONCURRENT) {
  vectors.push({
    id: c.id,
    why: c.why,
    engineOutcomes: c.outcomes,
    record: RECORDS.verified,
    asOf: AS_OF,
    evidenceMaxAgeMs: MAX_AGE_MS,
    policyRequiresRemediation: true,
    expectEngineOutcome: "allow",
    expectState: "verified",
    expectOutcome: "step_up",
    expectReasonCode: "ALLOW_WITHHELD_CONCURRENT_FAILURE",
    expectAllowWithheld: true,
  });
}

// ── GROUP D: the illegibility variants, one per distinct cause ───────────────
const ILLEGIBLE_VARIANTS: Array<{ id: string; why: string; record: RemediationRecord; asOf?: string; maxAge?: number }> = [
  {
    id: "illegible-unknown-status-word",
    why: "a status vocabulary this build has never seen ('partially-verified') is not 'probably fine'",
    record: { id: "rem-7", status: "partially-verified", verifiedAt: FRESH_AT },
  },
  {
    id: "illegible-future-dated-verification",
    why: "a verification dated AFTER the reference instant is not evidence of freshness; it raises",
    record: { id: "rem-8", status: "verified", verifiedAt: FUTURE_AT },
  },
  {
    id: "illegible-missing-verified-instant",
    why: "a record claiming verification with no instant cannot be aged at all",
    record: { id: "rem-9", status: "verified", verifiedAt: null },
  },
  {
    id: "illegible-unreadable-reference-instant",
    why: "if the REFERENCE instant is unreadable the window is unanswerable; it raises rather than passing",
    record: { id: "rem-10", status: "verified", verifiedAt: FRESH_AT },
    asOf: "sometime tuesday",
  },
  {
    id: "illegible-non-finite-evidence-window",
    why: "an unreadable freshness bound cannot certify anything as inside it",
    record: { id: "rem-11", status: "verified", verifiedAt: FRESH_AT },
    maxAge: Number.NaN,
  },
  {
    id: "illegible-record-without-id",
    why: "a record with no readable identity cannot be reconciled with the decision it claims to close",
    record: { status: "verified", verifiedAt: FRESH_AT },
  },
  {
    id: "illegible-non-string-status",
    why: "a status that is not a string at all crossed the boundary as something else entirely",
    record: { id: "rem-13", status: 42, verifiedAt: FRESH_AT },
  },
];
for (const v of ILLEGIBLE_VARIANTS) {
  vectors.push({
    id: v.id,
    why: v.why,
    engineOutcomes: ENGINE_DECISIONS.allow,
    record: v.record,
    asOf: v.asOf ?? AS_OF,
    evidenceMaxAgeMs: v.maxAge === undefined ? MAX_AGE_MS : v.maxAge,
    policyRequiresRemediation: true,
    expectEngineOutcome: "allow",
    expectState: "illegible",
    expectOutcome: "step_up",
    expectReasonCode: "REMEDIATION_STATE_ILLEGIBLE",
    expectAllowWithheld: true,
  });
}

// ── GROUP E: requirement derivation ──────────────────────────────────────────
// The requirement is DERIVED from the engine's own outcomes. `verify_remediation`
// with no record is a contradiction the wrapper must catch even when the caller
// states no policy requirement at all.
vectors.push({
  id: "derived-requirement-verify-remediation-without-record",
  why: "the engine acknowledged a remediation (verify_remediation) and no record arrived; the requirement is derived from the decision, not from the caller",
  engineOutcomes: ["verify_remediation", "allow", "record_audit"],
  record: null,
  asOf: AS_OF,
  evidenceMaxAgeMs: MAX_AGE_MS,
  policyRequiresRemediation: false,
  expectEngineOutcome: "allow",
  expectState: "absent",
  expectOutcome: "step_up",
  expectReasonCode: "REMEDIATION_ABSENT_WHERE_REQUIRED",
  expectAllowWithheld: true,
});
vectors.push({
  id: "derived-requirement-request-remediation-without-record",
  why: "the engine ASKED for a remediation (request_remediation); absence is a deficiency even with no policy flag set",
  engineOutcomes: ["request_remediation", "step_up", "record_audit"],
  record: null,
  asOf: AS_OF,
  evidenceMaxAgeMs: MAX_AGE_MS,
  policyRequiresRemediation: false,
  expectEngineOutcome: "step_up",
  expectState: "absent",
  expectOutcome: "step_up",
  expectReasonCode: "REMEDIATION_ABSENT_WHERE_REQUIRED",
  expectAllowWithheld: false,
});

// ── 1. EVERY VECTOR, both halves: classification and resolution ──────────────
for (const v of vectors) {
  const state = classifyRemediation(v.record, {
    asOf: v.asOf,
    evidenceMaxAgeMs: v.evidenceMaxAgeMs,
  });
  check(`${v.id}: record classifies as ${v.expectState}`, state === v.expectState);

  const out = resolveRemediationAllow({
    decision: { outcomes: v.engineOutcomes },
    record: v.record,
    asOf: v.asOf,
    evidenceMaxAgeMs: v.evidenceMaxAgeMs,
    policyRequiresRemediation: v.policyRequiresRemediation,
  });
  check(
    `${v.id}: engine ${v.expectEngineOutcome} -> host ${v.expectOutcome} (${v.expectReasonCode})`,
    out.engineOutcome === v.expectEngineOutcome &&
      out.hostOutcome === v.expectOutcome &&
      out.reasonCode === v.expectReasonCode &&
      out.allowWithheld === v.expectAllowWithheld,
  );
}

// ── 1b. DETERMINISM: an instant with no explicit zone is illegible ───────────
// Date.parse reads a zoneless date-time in the HOST's LOCAL time and a bare date as
// UTC — a machine- and clock-dependent parse golden rule 2 forbids in a decision
// path, and a form the Swift twin's ISO8601 parser rejects. Every such instant must
// read as illegible (raise, never lower), the same in every timezone. Falsifiable:
// before instantMs required a zone, a fresh-looking zoneless verifiedAt classified as
// verified/stale by the runner's own offset, so this block went green in some zones
// and red in others; now it is green everywhere. Confirmed by the Mac lane (note 6).
const ZONELESS_INSTANTS = ["2026-06-09T14:00:00", "2026-06-09T14:00:00.000", "2026-06-09", "06/09/2026"];
for (const ts of ZONELESS_INSTANTS) {
  check(
    `determinism: verifiedAt "${ts}" (no explicit zone) is illegible, never read against the host clock`,
    classifyRemediation({ id: "det", status: "verified", verifiedAt: ts }, { asOf: AS_OF, evidenceMaxAgeMs: MAX_AGE_MS }) ===
      "illegible",
  );
  check(
    `determinism: asOf "${ts}" (no explicit zone) is illegible`,
    classifyRemediation({ id: "det", status: "verified", verifiedAt: AS_OF }, { asOf: ts, evidenceMaxAgeMs: MAX_AGE_MS }) ===
      "illegible",
  );
}
{
  const out = resolveRemediationAllow({
    decision: { outcomes: ["allow"] },
    record: { id: "det", status: "verified", verifiedAt: "2026-06-09T14:00:00" },
    asOf: AS_OF,
    evidenceMaxAgeMs: MAX_AGE_MS,
    policyRequiresRemediation: true,
  });
  check(
    "determinism: an engine allow on a zoneless verification instant is withheld to step_up/illegible",
    out.hostOutcome === "step_up" &&
      out.reasonCode === "REMEDIATION_STATE_ILLEGIBLE" &&
      out.allowWithheld === true,
  );
}

// ── 2. NEVER UPWARD ──────────────────────────────────────────────────────────
const upgraded = vectors.filter((v) => {
  const out = resolveRemediationAllow({
    decision: { outcomes: v.engineOutcomes },
    record: v.record,
    asOf: v.asOf,
    evidenceMaxAgeMs: v.evidenceMaxAgeMs,
    policyRequiresRemediation: v.policyRequiresRemediation,
  });
  return strictnessOf(out.hostOutcome) < strictnessOf(out.engineOutcome);
});
check(
  `the wrapper never moves the engine's outcome in the permissive direction (offenders: ${upgraded.map((v) => v.id).join(", ") || "none"})`,
  upgraded.length === 0,
);

// ── 3. MONOTONICITY over the state axis ──────────────────────────────────────
// Worse remediation evidence must never buy a better outcome. Ordered worst-last.
const STATE_BADNESS: RemediationState[] = [
  "verified",
  "stale",
  "recorded_unverified",
  "recorded_failed",
  "absent",
  "illegible",
];
check(
  "the badness order covers every declared remediation state (no state escapes the sweep)",
  STATE_BADNESS.length === REMEDIATION_STATES.length &&
    REMEDIATION_STATES.every((s) => STATE_BADNESS.includes(s)),
);
for (const engineOutcome of HOST_OUTCOMES) {
  const ranks = STATE_BADNESS.map((state) =>
    strictnessOf(
      resolveRemediationAllow({
        decision: { outcomes: ENGINE_DECISIONS[engineOutcome] },
        record: RECORDS[state],
        asOf: AS_OF,
        evidenceMaxAgeMs: MAX_AGE_MS,
        policyRequiresRemediation: true,
      }).hostOutcome,
    ),
  );
  check(
    `monotonic for engine=${engineOutcome}: worse evidence never yields a better outcome (${ranks.join("<=")})`,
    ranks.every((r, i) => i === 0 || r >= ranks[i - 1]),
  );
}

// ── 4. NON-VACUITY ───────────────────────────────────────────────────────────
// A table where everything is withheld proves nothing: a wrapper hardcoded to
// step_up would pass it. So the grant must be REACHABLE.
const grantVector = vectors.find(
  (v) => v.expectOutcome === "allow" && v.expectState === "verified" && v.expectEngineOutcome === "allow",
);
check(
  "non-vacuity: verified evidence + an engine allow DOES yield allow (a step_up-always wrapper fails here)",
  grantVector !== undefined &&
    resolveRemediationAllow({
      decision: { outcomes: grantVector.engineOutcomes },
      record: grantVector.record,
      asOf: grantVector.asOf,
      evidenceMaxAgeMs: grantVector.evidenceMaxAgeMs,
      policyRequiresRemediation: grantVector.policyRequiresRemediation,
    }).hostOutcome === "allow",
);
for (const outcome of HOST_OUTCOMES) {
  check(
    `non-vacuity: some vector expects host outcome "${outcome}"`,
    vectors.some((v) => v.expectOutcome === outcome),
  );
}
const uncovered = REMEDIATION_ALLOW_REASONS.filter((r) => !vectors.some((v) => v.expectReasonCode === r));
check(
  `every declared reason code is exercised by a vector (uncovered: ${uncovered.join(", ") || "none"})`,
  uncovered.length === 0,
);
const uncoveredStates = REMEDIATION_STATES.filter((s) => !vectors.some((v) => v.expectState === s));
check(
  `every declared remediation state is exercised by a vector (uncovered: ${uncoveredStates.join(", ") || "none"})`,
  uncoveredStates.length === 0,
);
const ids = vectors.map((v) => v.id);
check("vector ids are unique", new Set(ids).size === ids.length);
check("every vector states WHY it exists", vectors.every((v) => (v.why ?? "").length > 20));

// ── 5. PROJECTION NEVER INVENTS A GRANT ──────────────────────────────────────
check(
  "projectEngineOutcome returns allow ONLY when the engine said allow",
  projectEngineOutcome(["alert_operator", "route_to_owner", "record_audit"]) !== "allow" &&
    projectEngineOutcome(["record_audit"]) !== "allow" &&
    projectEngineOutcome([]) !== "allow" &&
    projectEngineOutcome(["allow", "record_audit"]) === "allow",
);

// ── 6. THE LIVE ENGINE ───────────────────────────────────────────────────────
// Bound to the REAL simulator, not to a transcription of it. The shipping
// remediation scenario must still be able to reach allow (non-vacuity against the
// product), and the defect shape must not.
const remScenario = listSimulatorScenarios().find((s) => s.id === "remediation-verified");
check("the shipping remediation-verified scenario still exists", remScenario !== undefined);

if (remScenario) {
  const clean = runScenario(remScenario);
  const cleanOut = resolveRemediationAllow({
    decision: clean.decision,
    record: RECORDS.verified,
    asOf: AS_OF,
    evidenceMaxAgeMs: MAX_AGE_MS,
  });
  check(
    "live engine: the clean remediation scenario with VERIFIED evidence still allows (the wrapper does not break the product)",
    cleanOut.hostOutcome === "allow" && cleanOut.reasonCode === "REMEDIATION_VERIFIED",
  );
  check(
    "live engine: the same scenario with an UNVERIFIED record no longer allows",
    resolveRemediationAllow({
      decision: clean.decision,
      record: RECORDS.recorded_unverified,
      asOf: AS_OF,
      evidenceMaxAgeMs: MAX_AGE_MS,
    }).hostOutcome === "step_up",
  );

  // The defect from the verdict-core second read, driven through the real engine:
  // add a finding whose allow-suppression the engine does not perform.
  const rider = remScenario.startingSignals[0];
  const withFinding = runScenario({
    ...remScenario,
    id: "remediation-verified-with-integration-failure",
    startingSignals: [
      ...remScenario.startingSignals,
      {
        ...rider,
        id: "sig-integration-failed",
        type: "api.integration_failed",
        layer: "integration",
        summary: "Integration route degraded",
        attributes: { integration: "itsm" },
      },
    ],
  });
  const riddenOut = resolveRemediationAllow({
    decision: withFinding.decision,
    record: RECORDS.verified,
    asOf: AS_OF,
    evidenceMaxAgeMs: MAX_AGE_MS,
  });
  check(
    "live engine: a verified remediation alongside an integration failure does NOT reach the host as allow",
    riddenOut.hostOutcome !== "allow" &&
      riddenOut.reasonCode === "ALLOW_WITHHELD_CONCURRENT_FAILURE",
  );
  // REPORTED, not gated — see the header.
  console.log(
    `  reported — the engine's own outcomes for that input: [${withFinding.decision.outcomes.join(", ")}]` +
      ` (raw allow present: ${withFinding.decision.outcomes.includes("allow") ? "yes" : "no"})`,
  );
}

// ── 7. SELF-TEST: the table must be able to fail ─────────────────────────────
// Two planted defects, each a real fail-open somebody could write, run against this
// exact vector table. If the table stays silent, it is proving nothing.
type Resolver = (v: Vector) => { hostOutcome: HostOutcome; reasonCode: string };

function violations(resolver: Resolver): string[] {
  return vectors
    .filter((v) => {
      const out = resolver(v);
      return out.hostOutcome !== v.expectOutcome || out.reasonCode !== v.expectReasonCode;
    })
    .map((v) => v.id);
}

const honest: Resolver = (v) =>
  resolveRemediationAllow({
    decision: { outcomes: v.engineOutcomes },
    record: v.record,
    asOf: v.asOf,
    evidenceMaxAgeMs: v.evidenceMaxAgeMs,
    policyRequiresRemediation: v.policyRequiresRemediation,
  });
check("self-test control: the real resolver satisfies every vector", violations(honest).length === 0);

/** PLANT 1 — a recorded-but-unverified remediation is waved through as allow. */
const plantUnverifiedPasses: Resolver = (v) => {
  const state = classifyRemediation(v.record, { asOf: v.asOf, evidenceMaxAgeMs: v.evidenceMaxAgeMs });
  if (state === "recorded_unverified") {
    return { hostOutcome: projectEngineOutcome(v.engineOutcomes), reasonCode: "REMEDIATION_VERIFIED" };
  }
  return honest(v);
};
const caught1 = violations(plantUnverifiedPasses);
check(
  `self-test: passing recorded-unverified through as allow is CAUGHT, by name (${caught1.slice(0, 3).join(", ")}${caught1.length > 3 ? ", …" : ""})`,
  caught1.includes("engine-allow-x-recorded_unverified"),
);

/** PLANT 2 — an illegible record is read as verified. */
const plantIllegibleReadsVerified: Resolver = (v) => {
  const state = classifyRemediation(v.record, { asOf: v.asOf, evidenceMaxAgeMs: v.evidenceMaxAgeMs });
  if (state === "illegible") {
    return { hostOutcome: projectEngineOutcome(v.engineOutcomes), reasonCode: "REMEDIATION_VERIFIED" };
  }
  return honest(v);
};
const caught2 = violations(plantIllegibleReadsVerified);
check(
  `self-test: reading an illegible record as verified is CAUGHT, by name (${caught2.slice(0, 3).join(", ")}${caught2.length > 3 ? ", …" : ""})`,
  caught2.includes("engine-allow-x-illegible") && caught2.includes("illegible-future-dated-verification"),
);

/** PLANT 3 — the concurrent-finding guard (the actual defect) is removed. */
const plantNoConcurrentGuard: Resolver = (v) => {
  const state = classifyRemediation(v.record, { asOf: v.asOf, evidenceMaxAgeMs: v.evidenceMaxAgeMs });
  if (state === "verified") {
    return { hostOutcome: projectEngineOutcome(v.engineOutcomes), reasonCode: "REMEDIATION_VERIFIED" };
  }
  return honest(v);
};
const caught3 = violations(plantNoConcurrentGuard);
check(
  `self-test: dropping the concurrent-finding guard is CAUGHT, by name (${caught3.slice(0, 3).join(", ")}${caught3.length > 3 ? ", …" : ""})`,
  caught3.includes("concurrent-integration-degraded"),
);

// ── 8. THE SHARED VECTOR FILE ────────────────────────────────────────────────
const document = {
  $comment:
    "Shared remediation-allow vectors. The TypeScript wrapper (lib/signalgrid-simulator/src/remediation-allow.ts) and its Swift twin must agree on EVERY case. Generated by scripts/src/remediation-allow-proof.ts — do not hand-edit; run `pnpm run proof:remediation-allow -- --emit`.",
  version: 1,
  rule:
    "An allow the engine offered stands only if the remediation evidence is VERIFIED and nothing else was found alongside it: a remediation that is recorded-but-not-verified, recorded with a failure, absent where one was required, stale beyond the caller's declared evidence window, or illegible never yields allow; any other finding present in the same decision never yields allow; the withheld allow drops to the NEXT-STRICTER outcome with a named reason code; an unknown or illegible remediation state raises the outcome and never lowers it; and this wrapper never moves the engine's own outcome in the permissive direction.",
  source: "lib/signalgrid-simulator/src/remediation-allow.ts",
  proof: "scripts/src/remediation-allow-proof.ts",
  requires: {
    $comment:
      "Non-vacuity floor, asserted by each client before the cases run. Without it a client that returns step_up unconditionally passes every withholding case and the suite proves nothing.",
    minCases: vectors.length,
    outcomesPresent: [...HOST_OUTCOMES],
    statesPresent: [...REMEDIATION_STATES],
    reasonCodesPresent: [...REMEDIATION_ALLOW_REASONS],
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
check(
  `${VECTOR_PATH} exists and is byte-identical to this table (re-emit with --emit if this fails)`,
  committed === serialized,
);
check(
  `${VECTOR_PATH} declares its own floor as the case count (${vectors.length})`,
  document.requires.minCases === vectors.length && vectors.length >= 30,
);

console.log(
  `\nfigures=vectors=${vectors.length},states=${REMEDIATION_STATES.length},reasonCodes=${REMEDIATION_ALLOW_REASONS.length},engineOutcomes=${HOST_OUTCOMES.length}`,
);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
