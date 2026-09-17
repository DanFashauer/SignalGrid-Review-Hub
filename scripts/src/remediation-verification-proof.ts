// Remediation-verification proof — fully OFFLINE and deterministic.
//
// Cascade join 4: a requested remediation is paired with the next real evidence read
// for the same target, and the verdict says whether the fix actually landed. The
// property the whole join exists for is a NEGATIVE one, and it is the one a
// reasonable-looking implementation gets wrong:
//
//   `unobserved` IS NOT `cleared`.
//
// "We looked and the problem is gone" and "we never looked" produce the same silence
// and are opposite facts. Every shape that yields no admissible observation — no read
// at all, a read for the wrong target, a read predating the request, a read after the
// reference instant, a read whose instant does not parse, a request or reference
// instant that does not parse, and an action nobody approved — is enumerated here and
// asserted to keep the restriction ON.
//
// TWO load-bearing negatives:
//
//  * THE UNAPPROVED ACTION. Every proposal is born `requires_approval` and nothing in
//    this core executes, so an unapproved remediation had nothing to observe. The
//    tempting implementation checks the evidence first and would CLEAR it whenever the
//    reason code happened to go away on its own — lifting a restriction on a
//    coincidence, for a fix nobody ever carried out. Asserted below with evidence that
//    WOULD clear an approved action, so the assertion can only pass for the right reason.
//
//  * THE UNPARSEABLE INSTANT. `Date.parse` returns NaN and every comparison against
//    NaN is false, so a naive filter silently drops the read and the result is
//    indistinguishable from "no reads existed". That is the correct verdict, but only
//    by accident unless the unparseable REQUEST instant is handled too: with
//    `requestedMs = NaN`, `ms > requestedMs` is false for every read, which also looks
//    like "no reads" — right answer, wrong reason, and it flips the moment anyone
//    reorders the comparison. Both are pinned explicitly rather than left incidental.
import {
  verifyRemediation,
  restrictionHolds,
  needsIntervention,
  type RemediationAction,
  type EvidenceRead,
} from "@workspace/signalgrid-core";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Remediation-verification proof");

const CODE = "DEVICE_POSTURE_STALE";
const REQUESTED_AT = "2026-09-17T10:00:00.000Z";
const ASOF = "2026-09-17T12:00:00.000Z";

const action = (over: Partial<RemediationAction> = {}): RemediationAction => ({
  id: "rem-771",
  tenantId: "t-northwind",
  decisionId: "dec-5150",
  kind: "request_posture_refresh",
  targetType: "device",
  targetRef: "device:cart-14",
  reasonCode: CODE,
  status: "approved_simulated",
  approvalRequired: true,
  simulatedOnly: true,
  requestedAt: REQUESTED_AT,
  approvedAt: "2026-09-17T10:05:00.000Z",
  note: "fixture",
  ...over,
});

const APPROVED = action();

const read = (over: Partial<EvidenceRead> = {}): EvidenceRead => ({
  targetRef: "device:cart-14",
  reasonCodes: [],
  observedAt: "2026-09-17T11:00:00.000Z",
  ...over,
});

// ── 1. the three verdicts are actually reachable ──────────────────────────────
const cleared = verifyRemediation(APPROVED, [read()], ASOF);
check("a read after the request WITHOUT the code clears it", cleared.state === "cleared");
check("a cleared verdict names the observation it rests on", cleared.observedAt === "2026-09-17T11:00:00.000Z");

const notCleared = verifyRemediation(APPROVED, [read({ reasonCodes: [CODE] })], ASOF);
check("a read after the request WITH the code is not_cleared", notCleared.state === "not_cleared");

const none = verifyRemediation(APPROVED, [], ASOF);
check("no reads at all is unobserved", none.state === "unobserved");
check("an unobserved verdict names NO observation (a fabricated status is worse than none)", none.observedAt === null);

// ── 2. THE POINT: unobserved is not cleared ───────────────────────────────────
check("unobserved KEEPS the restriction on", restrictionHolds(none));
check("not_cleared KEEPS the restriction on", restrictionHolds(notCleared));
check("only an observed clear lifts the restriction", restrictionHolds(cleared) === false);
check("unobserved and cleared are distinguishable states", none.state !== cleared.state);

// ── 3. LOAD-BEARING: a remediation nobody approved cannot have landed ─────────
// The same evidence that CLEARS the approved action above must not clear these.
const awaiting = verifyRemediation(action({ status: "requires_approval" }), [read()], ASOF);
check("an UNAPPROVED remediation is unobserved even when the code is gone", awaiting.state === "unobserved");
check("…and the restriction stays on", restrictionHolds(awaiting));
check("…and it is the SAME evidence that cleared the approved action", cleared.state === "cleared");
check("…so a coincidental improvement cannot close a fix nobody carried out", awaiting.observedAt === null);

const dismissed = verifyRemediation(action({ status: "dismissed" }), [read()], ASOF);
check("a DISMISSED remediation is unobserved — the code was never cleared", dismissed.state === "unobserved");
check("…and the restriction stays on", restrictionHolds(dismissed));
check("…but it never escalates: a person already ruled on it", dismissed.escalated === false && dismissed.misses === 0);

// ── 4. what is NOT admissible evidence ────────────────────────────────────────
const before = verifyRemediation(APPROVED, [read({ observedAt: "2026-09-17T09:00:00.000Z" })], ASOF);
check("a read PREDATING the request cannot clear it", before.state === "unobserved");

const atRequest = verifyRemediation(APPROVED, [read({ observedAt: REQUESTED_AT })], ASOF);
check("a read at the exact request instant cannot clear it (strictly after, not at)", atRequest.state === "unobserved");

const afterAsOf = verifyRemediation(APPROVED, [read({ observedAt: "2026-09-17T13:00:00.000Z" })], ASOF);
check("a read AFTER the reference instant is not yet knowledge", afterAsOf.state === "unobserved");

const atAsOf = verifyRemediation(APPROVED, [read({ observedAt: ASOF })], ASOF);
check("a read at exactly the reference instant IS admissible (at-or-before)", atAsOf.state === "cleared");

const otherTarget = verifyRemediation(APPROVED, [read({ targetRef: "device:cart-99" })], ASOF);
check("a read for a DIFFERENT target cannot clear this one", otherTarget.state === "unobserved");

const otherCode = verifyRemediation(APPROVED, [read({ reasonCodes: ["SOMETHING_ELSE"] })], ASOF);
check("an unrelated code present at the read does not block this one clearing", otherCode.state === "cleared");

// ── 5. LOAD-BEARING: unparseable instants tighten, never loosen ───────────────
const badRead = verifyRemediation(APPROVED, [read({ observedAt: "not-a-date" })], ASOF);
check("a read whose instant does not parse is NOT a clearing observation", badRead.state === "unobserved");
check("…and it keeps the restriction on", restrictionHolds(badRead));

const badRequest = verifyRemediation(action({ requestedAt: "whenever" }), [read()], ASOF);
check("an unparseable REQUEST instant refuses to clear (not: admits everything)", badRequest.state === "unobserved");

const badAsOf = verifyRemediation(APPROVED, [read()], "soon");
check("an unparseable REFERENCE instant refuses to clear", badAsOf.state === "unobserved");

const emptyAsOf = verifyRemediation(APPROVED, [read()], "");
check("an EMPTY reference instant refuses to clear (empty is not now)", emptyAsOf.state === "unobserved");

// ── 6. escalation — the "or jump in" half of the sentence ─────────────────────
const miss1 = verifyRemediation(APPROVED, [], ASOF, 0);
check("the first miss does not escalate", miss1.misses === 1 && miss1.escalated === false);

const miss2 = verifyRemediation(APPROVED, [], ASOF, miss1.misses);
check("the SECOND consecutive miss escalates", miss2.misses === 2 && miss2.escalated === true);

const miss3 = verifyRemediation(APPROVED, [], ASOF, miss2.misses);
check("escalation stays on for further misses", miss3.misses === 3 && miss3.escalated === true);

const awaiting2 = verifyRemediation(action({ status: "requires_approval" }), [read()], ASOF, 1);
check("a remediation left unapproved twice escalates — that IS the 'jump in' case", awaiting2.escalated === true);

const observedAfterMisses = verifyRemediation(APPROVED, [read()], ASOF, 5);
check("a real observation ends the miss streak", observedAfterMisses.misses === 0);
check("…and does not leave escalation latched on", observedAfterMisses.escalated === false);

const notClearedAfterMisses = verifyRemediation(APPROVED, [read({ reasonCodes: [CODE] })], ASOF, 5);
check("a not_cleared observation also ends the streak — we DID look", notClearedAfterMisses.misses === 0);

// ── 7. what needs a person ────────────────────────────────────────────────────
const queue = needsIntervention([cleared, none, miss2, notCleared, dismissed]);
check("needsIntervention surfaces the escalated miss", queue.includes(miss2));
check("needsIntervention surfaces not_cleared — the fix demonstrably did not land", queue.includes(notCleared));
check("needsIntervention does not surface a cleared fix", queue.includes(cleared) === false);
check("a FIRST unobserved miss is not yet a page", queue.includes(none) === false);
check("a dismissed action is not a page", queue.includes(dismissed) === false);

// ── 8. ordering: the earliest admissible read decides ─────────────────────────
const returning = verifyRemediation(
  APPROVED,
  [
    read({ observedAt: "2026-09-17T11:30:00.000Z", reasonCodes: [CODE] }),
    read({ observedAt: "2026-09-17T10:30:00.000Z", reasonCodes: [] }),
  ],
  ASOF,
);
check("the EARLIEST admissible read decides, not the array order", returning.observedAt === "2026-09-17T10:30:00.000Z");
check("…so a problem returning later is a new decision's business, not this fix failing", returning.state === "cleared");

// ── 9. determinism and provenance ─────────────────────────────────────────────
const twice = verifyRemediation(APPROVED, [read()], ASOF);
check("the same inputs derive the same id", twice.id === cleared.id);
check("a different reference instant derives a different id", verifyRemediation(APPROVED, [read()], "2026-09-17T12:00:01.000Z").id !== cleared.id);
check("the verification carries the decision it came from", cleared.decisionId === APPROVED.decisionId);
check("…and the tenant, so a verdict can never be read cross-tenant", cleared.tenantId === APPROVED.tenantId);
check("…and the remediation it verifies", cleared.remediationId === APPROVED.id);

// ── 10. SELF-TEST: this proof can actually fail ───────────────────────────────
// Each plants the defect the module is built to refuse and asserts it WOULD be caught.
check(
  "SELF-TEST: a restrictionHolds written as `state === 'not_cleared'` would wrongly lift on unobserved",
  (none.state === "not_cleared") === false && restrictionHolds(none) === true,
);
check(
  "SELF-TEST: an implementation checking evidence BEFORE approval would have cleared the unapproved action",
  awaiting.state !== cleared.state,
);
// This one was WRONG when first written, and the falsification run is what caught it.
// It read "…would have admitted the predating read", asserting on `before` — but
// `before` has a perfectly parseable request instant, so a NaN→0 coercion never
// touches it and the assertion passed with the defect planted. The defect actually
// surfaces on an unparseable REQUEST instant: coerced to 0, it precedes every read,
// so the first read admitted clears a remediation whose timing is unknown. Asserting
// on the case the defect reaches, and named for it.
check(
  "SELF-TEST: coercing an unparseable instant to 0 would place the request before every read and clear on the first",
  badRequest.state !== "cleared",
);
check(
  "a read predating a VALID request instant is refused for its own reason, not this one",
  before.state === "unobserved",
);
check(
  "SELF-TEST: an implementation defaulting an unreadable read to cleared would break case 5",
  badRead.state !== "cleared",
);

console.log(`\nRemediation-verification proof: ${passed}/${passed + failures.length}`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  console.log("summary=fail");
  process.exit(1);
}
console.log("summary=pass");
