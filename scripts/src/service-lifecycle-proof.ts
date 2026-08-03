// Service-lifecycle proof — OFFLINE and deterministic.
//
// Asserted, in order of how much each matters:
//   1. THE LIVE-CALL GATE refuses unless every condition holds, each gate
//      ISOLATED so a control on any one of them fires.
//   2. THE NAMED REFUSAL IS MECHANICAL. `provisioning` is carried and never
//      graded, and that is proved by sweeping the whole state space and
//      asserting that changing ONLY `provisioning` changes NOTHING. A refusal
//      written in a comment is a claim; this is a measurement.
//   3. NO UNJUSTIFIED CLEAN VERDICTS across the entire normalized state space,
//      with the clean set pinned to an EXACT count rather than a floor.
//   4. THE DOMINANCE RULE IS DIRECTIONAL. `lifecycle_concern` suppresses;
//      `unposed` does NOT. Both directions asserted, because getting the second
//      one backwards is the hole.
//   5. COVERAGE IS NOT CORROBORATION. `unassessed` and `consistent` both carry
//      action `none` and must stay distinguishable at the posture level.
//   6. THE WINNER IS ORDER-PROOF, asserted by permuting the state fields that
//      produce competing candidates.
//   7. THE NORMALIZER never invents a fact: an absent collection is `unknown`,
//      a garbled entry cannot manufacture the stripped finding, and an
//      unreadable instant is never an ordering.
//   8. NO NETWORK I/O in the family.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateServiceLifecycle,
  evaluateServiceLifecycleFixture,
  normalizeGraphServiceLifecycle,
  resolveServiceLifecycleConnector,
  SERVICE_LIFECYCLE_FIXTURES,
  SERVICE_LIFECYCLE_READ_CONTRACT,
} from "@workspace/integrations/service-lifecycle";
import type {
  AccountPlaneStanding,
  AssignmentOrder,
  LifecycleClosureState,
  NormalizedServiceLifecycle,
  ProvisioningState,
  ServiceAssignmentState,
  ServiceLifecycleAction,
  ServicePlaneReporting,
} from "@workspace/integrations/service-lifecycle";

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

console.log("Service-lifecycle proof — does the SERVICE plane still agree the principal is here?\n");

// ── 1. The live-call gate, each condition ISOLATED ───────────────────────────
const T = { readServiceLifecycle: async () => ({}) };
const FULL = {
  SIGNALGRID_TIER: "prod",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  SERVICE_LIFECYCLE_DIRECTORY: "entra",
  SERVICE_LIFECYCLE_ACCESS_TOKEN: "t",
};
check("default env (dev tier) refuses live", resolveServiceLifecycleConnector({}, T).mode === "fixture");
check(
  "ISOLATED: tier alone blocks live",
  resolveServiceLifecycleConnector({ ...FULL, SIGNALGRID_TIER: "dev" }, T).mode === "fixture",
);
check(
  "ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
  resolveServiceLifecycleConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T).mode === "fixture",
);
check(
  "ISOLATED: an unrecognised directory alone blocks live",
  resolveServiceLifecycleConnector({ ...FULL, SERVICE_LIFECYCLE_DIRECTORY: "nope" }, T).mode === "fixture",
);
check(
  "on-prem AD is refused BY NAME — there is no service-plan plane to read",
  resolveServiceLifecycleConnector({ ...FULL, SERVICE_LIFECYCLE_DIRECTORY: "active-directory" }, T).mode ===
    "fixture" && SERVICE_LIFECYCLE_READ_CONTRACT.activeDirectorySupported === false,
);
check(
  "ISOLATED: a missing credential alone blocks live",
  resolveServiceLifecycleConnector({ ...FULL, SERVICE_LIFECYCLE_ACCESS_TOKEN: "" }, T).mode === "fixture",
);
check(
  "no transport refuses even with every gate satisfied — this repo ships none",
  resolveServiceLifecycleConnector(FULL).mode === "fixture",
);
check(
  "NON-VACUITY: with every gate satisfied AND a transport injected, the gate does open",
  resolveServiceLifecycleConnector(FULL, T).mode === "live",
);
check(
  "the read contract names the lifecycle scope, so a permission gap cannot present as a finding",
  SERVICE_LIFECYCLE_READ_CONTRACT.requiredScopes.includes("User-LifeCycleInfo.Read.All"),
);

// ── The exhaustive normalized state space ────────────────────────────────────
const PLANE: ServicePlaneReporting[] = ["reported", "not_reported", "unknown"];
const ASSIGNMENT: ServiceAssignmentState[] = ["assigned", "none_assigned", "unknown"];
const CLOSURE: LifecycleClosureState[] = ["recorded", "none_recorded", "unknown"];
const SUPERSEDED: (boolean | null)[] = [true, false, null];
const ORDER: AssignmentOrder[] = ["before_closure", "after_closure", "not_comparable", "malformed"];
const PROVISIONING: ProvisioningState[] = ["provisioned", "pending", "failed", "unknown"];
const ACCOUNT: AccountPlaneStanding[] = ["clean", "lifecycle_concern", "unposed"];
const INTEGRITY = ["intact", "malformed"] as const;

const space: NormalizedServiceLifecycle[] = [];
for (const planeReporting of PLANE)
  for (const assignment of ASSIGNMENT)
    for (const closure of CLOSURE)
      for (const closureSuperseded of SUPERSEDED)
        for (const assignmentOrder of ORDER)
          for (const provisioning of PROVISIONING)
            for (const accountPlane of ACCOUNT)
              for (const reportIntegrity of INTEGRITY)
                space.push({
                  principalId: "p",
                  planeReporting,
                  assignment,
                  closure,
                  closureSuperseded,
                  assignmentOrder,
                  provisioning,
                  accountPlane,
                  reportIntegrity,
                });

const SPACE = space.length;
console.log(`\n  normalized state space: ${SPACE} states\n`);
check(
  `the swept space is the full cross-product (${SPACE})`,
  SPACE ===
    PLANE.length *
      ASSIGNMENT.length *
      CLOSURE.length *
      SUPERSEDED.length *
      ORDER.length *
      PROVISIONING.length *
      ACCOUNT.length *
      INTEGRITY.length,
);

const verdicts = space.map((s) => evaluateServiceLifecycle(s));

// ── 2. THE NAMED REFUSAL, measured ───────────────────────────────────────────
//
// `provisioning` is carried and never graded (types.ts header: it fails the
// row-45 asymmetry test, and under the embedded-UX law it belongs to the host
// app). Proving it: for every state, swapping ONLY `provisioning` must leave the
// verdict byte-identical.
{
  let differing = 0;
  let compared = 0;
  for (const s of space) {
    const base = JSON.stringify(evaluateServiceLifecycle(s));
    for (const p of PROVISIONING) {
      if (p === s.provisioning) continue;
      compared += 1;
      if (JSON.stringify(evaluateServiceLifecycle({ ...s, provisioning: p })) !== base) differing += 1;
    }
  }
  check(
    `the provisioning refusal is MECHANICAL: ${compared} single-field swaps, ${differing} verdict changes`,
    differing === 0 && compared === SPACE * (PROVISIONING.length - 1),
  );
  // NON-VACUITY: the same comparison over a field that IS graded must find
  // differences, or the assertion above proves only that the loop runs.
  let assignmentDiffering = 0;
  for (const s of space) {
    const base = JSON.stringify(evaluateServiceLifecycle(s));
    for (const a of ASSIGNMENT) {
      if (a === s.assignment) continue;
      if (JSON.stringify(evaluateServiceLifecycle({ ...s, assignment: a })) !== base) assignmentDiffering += 1;
    }
  }
  check(
    `...and the same sweep over a GRADED field does move the verdict (${assignmentDiffering} changes)`,
    assignmentDiffering > 0,
  );
}

// ── 3. No unjustified clean verdicts ─────────────────────────────────────────
//
// `consistent` is the ONE posture that reads as corroboration. Every state
// reaching it must have positively confirmed everything the dimension asks.
{
  const clean = space.filter((_, i) => verdicts[i]!.posture === "consistent");
  const unjustified = clean.filter(
    (s) =>
      s.reportIntegrity !== "intact" ||
      s.planeReporting !== "reported" ||
      s.accountPlane === "lifecycle_concern" ||
      s.assignment === "unknown" ||
      s.assignmentOrder === "malformed" ||
      // A closure we could not read never corroborates, EXCEPT where the
      // stripped rung already reports it at its own calibrated level — which is
      // `stripped`, not `consistent`, so no exception is needed here.
      s.closure === "unknown",
  );
  check(
    `no unjustified clean verdict anywhere in ${SPACE} states (${clean.length} clean, ${unjustified.length} unjustified)`,
    unjustified.length === 0,
  );
  check(`the clean set is non-empty — the dimension can say "fine" (${clean.length})`, clean.length > 0);
  // PINNED EXACTLY, not as a floor. A change that widens the clean set is the
  // change most worth noticing, and a `>= N` assertion would sleep through it.
  check(`the clean set is pinned exactly (${clean.length})`, clean.length === 104);

  // …and pinned in a form a reader can CHECK, which a bare count is not. Every
  // clean state collapses to one of these graded-field tuples; anything else
  // appearing here is a new way to be told "fine", which is the change worth
  // reading in a diff.
  const shapes = [...new Set(clean.map((s) => `${s.assignment}/${s.closure}/${s.closureSuperseded}/${s.assignmentOrder}`))].sort();
  console.log(`      clean shapes: ${shapes.join(" | ")}`);
  check(
    `the clean set collapses to ${shapes.length} named shapes, each a positively-confirmed reading`,
    JSON.stringify(shapes) ===
      JSON.stringify(
        [
          // Live entitlements, nobody left, nothing to order against.
          "assigned/none_recorded/null/not_comparable",
          // Live entitlements past a closure that a rehire explains.
          "assigned/recorded/true/after_closure",
          "assigned/recorded/true/before_closure",
          "assigned/recorded/true/not_comparable",
          // A COMPLETED offboarding: entitlements gone, departure recorded. All
          // nine orderings are clean, and the reason is worth stating because
          // the first draft of this list omitted six of them and the proof said
          // so. `assignmentOrder` describes where the LAST assignment sat, and
          // the last assignment is gone. `none_assigned/recorded/false/
          // after_closure` is a principal who WAS re-armed after departure and
          // has since been stripped again — a real governance failure, and a
          // HISTORICAL one. This dimension gates a live action, and the live
          // answer is that this principal now holds nothing. Grading the
          // finished state on a finished event would restrict a worker for
          // something already put right.
          "none_assigned/recorded/false/after_closure",
          "none_assigned/recorded/false/before_closure",
          "none_assigned/recorded/false/not_comparable",
          "none_assigned/recorded/null/after_closure",
          "none_assigned/recorded/null/before_closure",
          "none_assigned/recorded/null/not_comparable",
          "none_assigned/recorded/true/after_closure",
          "none_assigned/recorded/true/before_closure",
          "none_assigned/recorded/true/not_comparable",
        ].sort(),
      ),
  );

  check(
    "every clean verdict carries action `none`",
    space.every((_, i) => (verdicts[i]!.posture === "consistent" ? verdicts[i]!.recommendedAction === "none" : true)),
  );
}

// ── 4. The dominance rule is DIRECTIONAL ─────────────────────────────────────
{
  // The contradiction, with the account plane silent. Must fire.
  const contradiction: NormalizedServiceLifecycle = {
    principalId: "p",
    planeReporting: "reported",
    assignment: "none_assigned",
    closure: "none_recorded",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "clean",
    reportIntegrity: "intact",
  };
  const fired = evaluateServiceLifecycle(contradiction);
  check(
    "the stripped contradiction fires when the account plane is positively clean",
    fired.reasonCode === "SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE" && fired.recommendedAction === "step_up",
  );
  const suppressed = evaluateServiceLifecycle({ ...contradiction, accountPlane: "lifecycle_concern" });
  check(
    "…and is SUPPRESSED where access-governance already carries the concern (row 47)",
    suppressed.reasonCode === "ACCOUNT_PLANE_ALREADY_AUTHORITATIVE" &&
      suppressed.recommendedAction === "none" &&
      suppressed.posture === "deferred",
  );
  const unposed = evaluateServiceLifecycle({ ...contradiction, accountPlane: "unposed" });
  check(
    "…and `unposed` does NOT suppress — the suppression is the permissive move, so it is what must be earned",
    unposed.reasonCode === "SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE" && unposed.recommendedAction === "step_up",
  );
  // Swept, not just spot-checked: `lifecycle_concern` must silence EVERY finding.
  const anyConcernFinding = space.filter(
    (s, i) =>
      s.accountPlane === "lifecycle_concern" &&
      s.reportIntegrity === "intact" &&
      s.planeReporting === "reported" &&
      verdicts[i]!.recommendedAction !== "none",
  );
  check(
    `across the sweep, a positively-reported account-plane concern silences every finding (${anyConcernFinding.length} leaks)`,
    anyConcernFinding.length === 0,
  );
  // And the mirror: `unposed` must NOT be a blanket silence.
  const unposedFindings = space.filter(
    (s, i) => s.accountPlane === "unposed" && verdicts[i]!.recommendedAction !== "none",
  );
  check(`…while \`unposed\` still grades (${unposedFindings.length} findings survive)`, unposedFindings.length > 0);
}

// ── 5. Coverage is not corroboration ─────────────────────────────────────────
{
  const unassessed = space.filter((_, i) => verdicts[i]!.posture === "unassessed");
  check(
    `every unassessed verdict is action \`none\` and is a DIFFERENT posture from \`consistent\` (${unassessed.length})`,
    unassessed.length > 0 &&
      space.every((_, i) => (verdicts[i]!.posture === "unassessed" ? verdicts[i]!.recommendedAction === "none" : true)),
  );
  // The pair that must never merge. Both say `none`; only one is corroboration,
  // and a composition layer that reads ACTION alone would conflate them — which
  // is precisely why the distinction has to live in the posture.
  const noneActioned = space.filter((_, i) => verdicts[i]!.recommendedAction === "none");
  const nonePostures = new Set(space.map((_, i) => verdicts[i]!).filter((v) => v.recommendedAction === "none").map((v) => v.posture));
  check(
    `action \`none\` covers ${nonePostures.size} distinct postures over ${noneActioned.length} states — reading the action alone would conflate them`,
    nonePostures.has("consistent") && nonePostures.has("unassessed") && nonePostures.has("deferred"),
  );
  check(
    "a deployment with no licensing bridge is `unassessed`, NOT `consistent`",
    evaluateServiceLifecycleFixture("no-service-plane")?.posture === "unassessed",
  );
  check(
    "…and an unknown reporting state gets its OWN code, so a coverage audit can find it",
    evaluateServiceLifecycle({
      ...SERVICE_LIFECYCLE_FIXTURES["no-service-plane"]!,
      planeReporting: "unknown",
    }).reasonCode === "SERVICE_PLANE_REPORTING_UNKNOWN",
  );
}

// ── 6. The ceiling ───────────────────────────────────────────────────────────
{
  const actions = new Set<ServiceLifecycleAction>(verdicts.map((v) => v.recommendedAction));
  check(
    `the ceiling holds across the whole space — never alert, never escalate (saw: ${[...actions].sort().join(", ")})`,
    !actions.has("alert" as ServiceLifecycleAction) && !actions.has("escalate" as ServiceLifecycleAction),
  );
  check("…and `restrict` is reachable, so the ceiling is a cap and not a description", actions.has("restrict"));
  const restricts = space.filter((_, i) => verdicts[i]!.recommendedAction === "restrict");
  check(
    `restrict is reserved to the ONE affirmative act — a service plan assigned after an unsuperseded closure (${restricts.length} states)`,
    restricts.length > 0 &&
      restricts.every(
        (s) =>
          s.assignment === "assigned" &&
          s.closure === "recorded" &&
          s.assignmentOrder === "after_closure" &&
          s.closureSuperseded === false,
      ),
  );
}

// ── 7. Calibration: unconfirmed must never equal confirmed ───────────────────
{
  const base: NormalizedServiceLifecycle = {
    principalId: "p",
    planeReporting: "reported",
    assignment: "none_assigned",
    closure: "none_recorded",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "clean",
    reportIntegrity: "intact",
  };
  const confirmed = evaluateServiceLifecycle(base);
  const unconfirmed = evaluateServiceLifecycle({ ...base, closure: "unknown" });
  const RANK: Record<ServiceLifecycleAction, number> = { none: 0, monitor: 1, step_up: 2, restrict: 3 };
  check(
    "a stripped principal whose closure state is UNKNOWN grades strictly BELOW the confirmed contradiction",
    RANK[unconfirmed.recommendedAction] < RANK[confirmed.recommendedAction] &&
      unconfirmed.reasonCode === "SERVICE_STRIPPED_CLOSURE_UNKNOWN",
  );
  // A rehire explains the ordering; an unstated supersession does not, and the
  // two must not grade the same.
  const rearm = SERVICE_LIFECYCLE_FIXTURES["re-armed-after-departure"]!;
  check(
    "a rehire (supersession true) is not a finding",
    evaluateServiceLifecycle({ ...rearm, closureSuperseded: true }).recommendedAction === "none",
  );
  check(
    "…an UNSTATED supersession forecloses without asserting the hostile reading (step_up, not restrict)",
    evaluateServiceLifecycle({ ...rearm, closureSuperseded: null }).reasonCode ===
      "SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN" &&
      evaluateServiceLifecycle({ ...rearm, closureSuperseded: null }).recommendedAction === "step_up",
  );
  check(
    "…and a positively-denied supersession restricts",
    evaluateServiceLifecycle(rearm).recommendedAction === "restrict",
  );
  check(
    "entitlements outliving a recorded closure are named as their own posture",
    evaluateServiceLifecycleFixture("entitlements-outlived-departure")?.posture === "outlived",
  );
  check(
    "a completed offboarding (stripped + closure recorded) is NOT a finding",
    evaluateServiceLifecycleFixture("completed-offboarding")?.recommendedAction === "none",
  );
  check(
    "a recorded closure with live entitlements and no comparable instant reports the BLINDED check",
    evaluateServiceLifecycleFixture("reassignment-check-blinded")?.reasonCode === "REASSIGNMENT_CHECK_BLINDED",
  );
}

// ── 8. Coherence is graded, not ignored ──────────────────────────────────────
{
  const incoherent = space.filter((_, i) => verdicts[i]!.reasonCode === "SERVICE_REPORT_INCOHERENT");
  check(
    `self-contradicting reports are graded as their own class (${incoherent.length} states)`,
    incoherent.length > 0 &&
      incoherent.every(
        (s) =>
          (s.closure !== "recorded" &&
            (s.assignmentOrder === "before_closure" || s.assignmentOrder === "after_closure")) ||
          (s.closure === "none_recorded" && s.closureSuperseded !== null),
      ),
  );
  check(
    "…and no incoherent report ever reaches a clean verdict",
    incoherent.every((s) => evaluateServiceLifecycle(s).posture === "indeterminate"),
  );
}

// ── 9. The winner is ORDER-PROOF ─────────────────────────────────────────────
//
// The evaluator ranks by (action, fixed reason precedence) rather than by the
// order candidates were appended. Asserted by re-evaluating each state many
// times from a shuffled field order — the verdict must be identical every time.
{
  let unstable = 0;
  const keys: (keyof NormalizedServiceLifecycle)[] = [
    "planeReporting",
    "assignment",
    "closure",
    "closureSuperseded",
    "assignmentOrder",
    "provisioning",
    "accountPlane",
    "reportIntegrity",
    "principalId",
  ];
  for (const s of space) {
    const expected = JSON.stringify(evaluateServiceLifecycle(s));
    for (let round = 0; round < 3; round += 1) {
      // Rebuild the object with the keys in a rotated order. Property order is
      // observable in JS, and an evaluator that iterated its input would drift.
      const rotated: Record<string, unknown> = {};
      for (let k = 0; k < keys.length; k += 1) {
        const key = keys[(k + round + 1) % keys.length]!;
        rotated[key] = s[key];
      }
      if (JSON.stringify(evaluateServiceLifecycle(rotated as unknown as NormalizedServiceLifecycle)) !== expected) {
        unstable += 1;
      }
    }
  }
  check(`the verdict is independent of input property order (${SPACE * 3} re-evaluations)`, unstable === 0);

  // THE COLLISION that makes the tie-break falsifiable. `REASON_PRECEDENCE`
  // orders by SPECIFICITY and `ACTION_RANK` by SEVERITY, and here they disagree:
  // `ASSIGNMENT_ORDER_MALFORMED` is the more specific finding (it names the field
  // that failed to parse) and the lower-severity one (monitor vs step_up). The
  // ladder must win, precedence must only break ties — and this is the state
  // where a `strongest()` that forgot the action-equality guard would report the
  // monitor instead. The mutation sweep found that guard unfalsifiable before
  // this assertion existed.
  const collision = evaluateServiceLifecycle({
    principalId: "p",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "unknown",
    closureSuperseded: null,
    assignmentOrder: "malformed",
    provisioning: "unknown",
    accountPlane: "clean",
    reportIntegrity: "intact",
  });
  check(
    "where specificity and severity disagree, the ACTION LADDER decides and precedence only breaks ties",
    collision.reasonCode === "LIFECYCLE_CLOSURE_STATE_UNKNOWN" && collision.recommendedAction === "step_up",
  );
}

// ── 10. The normalizer never invents a fact ──────────────────────────────────
{
  const ID = "u-1";
  check(
    "a MISSING assignedPlans collection is `unknown`, never `none_assigned` (the absent-collection law)",
    normalizeGraphServiceLifecycle({ id: ID }).assignment === "unknown",
  );
  check(
    "…while a PRESENT empty array is a real enumeration and does read `none_assigned`",
    normalizeGraphServiceLifecycle({ id: ID, assignedPlans: [] }).assignment === "none_assigned",
  );
  check(
    "one unclassifiable plan entry makes the whole answer `unknown` — a garbled feed cannot manufacture the stripped finding",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Enabled" }, { capabilityStatus: "SomethingNew" }],
    }).assignment === "unknown",
  );
  check(
    "Deleted/Suspended plans do not count as live",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Deleted" }, { capabilityStatus: "Suspended" }],
    }).assignment === "none_assigned",
  );
  check(
    "an ASSERTED but unreadable leave date is `unknown` closure — never `recorded` on the strength of a value that failed to parse",
    normalizeGraphServiceLifecycle({ id: ID, assignedPlans: [], employeeLeaveDateTime: "last tuesday" }).closure ===
      "unknown",
  );
  check(
    "a non-UTC instant spelling is refused rather than coerced",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [],
      employeeLeaveDateTime: "2026-01-02T03:04:05+01:00",
    }).closure === "unknown",
  );
  {
    const reArmed = normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Enabled", assignedDateTime: "2026-03-01T00:00:00Z" }],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
    });
    check(
      "two source-reported instants alone answer the ordering — no clock, no reference instant",
      reArmed.assignmentOrder === "after_closure" && reArmed.closure === "recorded",
    );
    check(
      "…and with no hire date the supersession stays UNKNOWN rather than assumed either way",
      reArmed.closureSuperseded === null &&
        evaluateServiceLifecycle(reArmed).reasonCode === "SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN",
    );
    const rehired = normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Enabled", assignedDateTime: "2026-03-01T00:00:00Z" }],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
      employeeHireDate: "2026-02-20T00:00:00Z",
    });
    check(
      "a hire date AFTER the leave date resolves it to a rehire, and the finding stands down",
      rehired.closureSuperseded === true && evaluateServiceLifecycle(rehired).recommendedAction === "none",
    );
    const leftAgain = normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Enabled", assignedDateTime: "2026-03-01T00:00:00Z" }],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
      employeeHireDate: "2025-01-01T00:00:00Z",
    });
    check(
      "…a hire date BEFORE the leave date does not — that is the original hire, and the re-arming restricts",
      leftAgain.closureSuperseded === false &&
        evaluateServiceLifecycle(leftAgain).reasonCode === "SERVICE_REASSIGNED_AFTER_CLOSURE",
    );
  }
  check(
    "an unreadable assignment instant becomes `malformed`, not a silent absence",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [{ capabilityStatus: "Enabled", assignedDateTime: 1735689600000 }],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
    }).assignmentOrder === "malformed",
  );
  // …AND IT POISONS THE WHOLE ORDERING rather than being outvoted by its
  // readable neighbours. Found by the mutation sweep: with a single plan the
  // malformed branch and the max() branch land on the same answer, so a
  // one-plan case cannot tell them apart. With a readable plan alongside it,
  // dropping the branch computes `Math.max(number, "malformed")` = NaN and the
  // ordering silently stops being malformed.
  check(
    "…and ONE unreadable instant poisons the ordering even when a readable plan sits beside it",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [
        { capabilityStatus: "Enabled", assignedDateTime: "2025-01-01T00:00:00Z" },
        { capabilityStatus: "Enabled", assignedDateTime: "not an instant" },
      ],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
    }).assignmentOrder === "malformed",
  );
  check(
    "…in either order, so the result does not depend on which plan is read first",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [
        { capabilityStatus: "Enabled", assignedDateTime: "not an instant" },
        { capabilityStatus: "Enabled", assignedDateTime: "2025-01-01T00:00:00Z" },
      ],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
    }).assignmentOrder === "malformed",
  );
  // HOSTILE ENTRY SHAPES. A vendor array may hold anything at all, and the entry
  // guard has to survive a `null` (which throws on property access) as well as
  // the merely-unexpected. The sweep survived the guard's removal because every
  // entry the proof fed was an object.
  for (const hostile of [null, "Enabled", 42, ["Enabled"], undefined, true] as unknown[]) {
    let threw = false;
    let state: ServiceAssignmentState | null = null;
    try {
      state = normalizeGraphServiceLifecycle({
        id: ID,
        assignedPlans: [{ capabilityStatus: "Enabled" }, hostile],
      }).assignment;
    } catch {
      threw = true;
    }
    check(
      `a non-object plan entry (${JSON.stringify(hostile) ?? "undefined"}) neither throws nor grades — it reads \`unknown\``,
      !threw && state === "unknown",
    );
  }
  check(
    "…and a hostile provisionedPlans entry is `unknown` rather than a thrown read",
    normalizeGraphServiceLifecycle({ id: ID, assignedPlans: [], provisionedPlans: [null] }).provisioning === "unknown",
  );
  check(
    "the latest live assignment wins the comparison, not the first one read",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [
        { capabilityStatus: "Enabled", assignedDateTime: "2025-01-01T00:00:00Z" },
        { capabilityStatus: "Enabled", assignedDateTime: "2026-03-01T00:00:00Z" },
      ],
      employeeLeaveDateTime: "2026-02-01T00:00:00Z",
    }).assignmentOrder === "after_closure",
  );
  check(
    "a payload with no identifiable subject is malformed, not a pile of confident unknowns",
    normalizeGraphServiceLifecycle({ assignedPlans: [] }).reportIntegrity === "malformed",
  );
  check(
    "the account plane and the reporting state are PARAMETERS — a payload cannot vote on its own suppression",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ accountPlane: "lifecycle_concern", planeReporting: "not_reported" } as any),
    }).accountPlane === "unposed",
  );
  check(
    "provisioning is read from provisionedPlans and carried",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [],
      provisionedPlans: [{ provisioningStatus: "PendingProvisioning" }],
    }).provisioning === "pending",
  );
  check(
    "…and an unrecognised provisioning status is `unknown`, not coerced to a neighbour",
    normalizeGraphServiceLifecycle({
      id: ID,
      assignedPlans: [],
      provisionedPlans: [{ provisioningStatus: "Whatever" }],
    }).provisioning === "unknown",
  );
}

// ── 11. Fixture lookup is hostile-safe ───────────────────────────────────────
{
  check("an unknown fixture name returns null", evaluateServiceLifecycleFixture("no-such-fixture") === null);
  for (const proto of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    check(`a prototype key (\`${proto}\`) returns null and never grades`, evaluateServiceLifecycleFixture(proto) === null);
  }
  check(
    "every declared fixture grades",
    Object.keys(SERVICE_LIFECYCLE_FIXTURES).every((k) => evaluateServiceLifecycleFixture(k) !== null),
  );
}

// ── 12. No vendor-API call anywhere in the family ────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "../../lib/integrations/src/integrations/service-lifecycle");
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  const files = walk(dir);
  const offenders: string[] = [];
  const banned = [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    /\b(?:const|let|var)\s+\w+\s*=\s*fetch\b/i,
    /\brequire\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i,
    /\bimport\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i,
    /\bfrom\s+['"](?:axios|got|undici|node-fetch|superagent|request)['"]/i,
    /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
    /\bhttps?\.(?:request|get)\s*\(/i,
    /\bnet\.(?:connect|createConnection)\s*\(/i,
    /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
  ];
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (banned.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}`);
      });
  }
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  check(
    `no VENDOR-API call in any service-lifecycle/ source (${files.length} files scanned recursively)`,
    offenders.length === 0,
  );
  check(
    "...and the scan actually detects a planted vendor call",
    banned.some((re) => re.test(`await fetch("https://graph.microsoft.com/v1.0/users", { method: "POST" })`)) &&
      banned.some((re) => re.test(`const { Redis } = await import("ioredis");`)),
  );
  // NO CLOCK. The dimension's whole ordering argument rests on comparing two
  // source-reported instants, so a clock read anywhere in the family would
  // quietly turn a deterministic verdict into a time-dependent one.
  const clockOffenders: string[] = [];
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (/\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(|\bperformance\.now\s*\(/.test(line)) {
          clockOffenders.push(`${rel}:${i + 1}`);
        }
      });
  }
  if (clockOffenders.length) console.log(`      clock offenders: ${clockOffenders.join(", ")}`);
  check("no clock and no randomness anywhere in the family", clockOffenders.length === 0);
  check(
    "...and that scan fires on a planted clock read",
    /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(/.test("const t = Date.now();"),
  );
}

console.log("");
console.log(
  `figures=states=${SPACE},provisioningSwaps=${SPACE * (PROVISIONING.length - 1)},reevaluations=${SPACE * 3}`,
);
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
